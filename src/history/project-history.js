import { filterObservationsForPersona } from '../memory/persona-filter.js';

function toEpochMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function buildHistorySection(last, personaObs, persona) {
  const parts = [];
  if (last) {
    const summary = last.completed ?? last.title ?? last.request ?? '';
    const nextBit = last.nextSteps ? ` Next: ${last.nextSteps}.` : '';
    parts.push(`## Last Session\n${summary}.${nextBit}`);
  }
  if (personaObs.length > 0) {
    const bullets = personaObs
      .map((o) => {
        const files = o.filesModified.slice(0, 3).join(', ');
        const filesPart = files ? ` (${files})` : '';
        return `- ${o.title ?? o.type}${o.subtitle ? ` — ${o.subtitle}` : ''}${filesPart}`;
      })
      .join('\n');
    parts.push(`## Recent Work as ${persona.label}\n${bullets}`);
  }
  return parts.join('\n\n');
}

/**
 * Provider-neutral history store backed by the agent-office repository.
 *
 * @param {ReturnType<import('../db/repository.js').createRepository>} repo
 */
export function createProjectHistoryStore(repo) {
  function getLaunchHistory(projectId, persona, { summaryLimit = 1, observationLimit = 50, personaObservationLimit = 10 } = {}) {
    const summaries = repo.listHistorySummaries({ projectId, limit: summaryLimit });
    const observations = repo.listHistoryObservations({ projectId, limit: observationLimit });
    const lastSummary = summaries[0] ?? null;
    const personaObservations = filterObservationsForPersona(observations, persona, {
      limit: personaObservationLimit,
    });

    return {
      lastSession: lastSummary
        ? {
            title: lastSummary.request,
            completed: lastSummary.completed,
            nextSteps: lastSummary.nextSteps,
            at: lastSummary.createdAt,
          }
        : null,
      personaObservations,
      section: buildHistorySection(lastSummary, personaObservations, persona),
    };
  }

  function ingest({
    projectId,
    projectPath,
    personaId,
    providerId,
    providerSessionId,
    startedAt,
    endedAt,
    status,
    model,
    systemPrompt,
    source,
    summary,
    observations = [],
  }) {
    if (!providerId) throw new Error('providerId is required');
    if (!projectId && !projectPath) throw new Error('projectId or projectPath is required');

    const project = projectId != null ? repo.getProject(Number(projectId)) : repo.getProjectByPath(projectPath);
    if (!project) throw new Error('Project not found');

    let historySession =
      providerSessionId != null ? repo.getHistorySessionByProvider(providerId, providerSessionId) : null;

    if (!historySession) {
      const historySessionId = repo.createHistorySession({
        projectId: project.id,
        personaId: personaId != null ? Number(personaId) : null,
        providerId,
        providerSessionId,
        startedAt,
        endedAt,
        status,
        model,
        systemPrompt,
        source,
      });
      historySession = repo.getHistorySession(Number(historySessionId));
    } else {
      repo.updateHistorySession(historySession.id, {
        personaId: personaId != null ? Number(personaId) : null,
        startedAt,
        endedAt,
        status,
        model,
        systemPrompt,
        source,
      });
      historySession = repo.getHistorySession(historySession.id);
    }

    let summaryId = null;
    if (summary) {
      summaryId = Number(
        repo.createHistorySummary({
          historySessionId: historySession.id,
          projectId: project.id,
          providerId,
          summaryKind: summary.summaryKind,
          request: summary.request,
          investigated: summary.investigated,
          learned: summary.learned,
          completed: summary.completed,
          nextSteps: summary.nextSteps,
          filesRead: summary.filesRead,
          filesEdited: summary.filesEdited,
          notes: summary.notes,
          createdAt: summary.createdAt,
          createdAtEpoch: toEpochMillis(summary.createdAtEpoch ?? summary.createdAt),
        }),
      );
    }

    const observationIds = observations.map((observation) =>
      Number(
        repo.createHistoryObservation({
          historySessionId: historySession.id,
          projectId: project.id,
          providerId,
          type: observation.type,
          title: observation.title,
          subtitle: observation.subtitle,
          narrative: observation.narrative,
          facts: observation.facts,
          concepts: observation.concepts,
          filesRead: observation.filesRead,
          filesModified: observation.filesModified,
          turnNumber: observation.turnNumber,
          contentHash: observation.contentHash,
          generatedByModel: observation.generatedByModel ?? model ?? null,
          relevanceCount: observation.relevanceCount,
          confidence: observation.confidence,
          createdAt: observation.createdAt,
          createdAtEpoch: toEpochMillis(observation.createdAtEpoch ?? observation.createdAt),
          expiresAt: observation.expiresAt,
        }),
      ),
    );

    return {
      project,
      historySession,
      summaryId,
      observationIds,
    };
  }

  function listProjectHistory(projectId, { summaryLimit = 10, observationLimit = 25 } = {}) {
    return {
      summaries: repo.listHistorySummaries({ projectId, limit: summaryLimit }),
      observations: repo.listHistoryObservations({ projectId, limit: observationLimit }),
    };
  }

  return {
    getLaunchHistory,
    ingest,
    listProjectHistory,
  };
}
