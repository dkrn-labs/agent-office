import { filterObservationsForPersona } from '../memory/persona-filter.js';
import { getPersonaBrief, buildManualBrief } from '../memory/brief/brief.js';
import { embedBatch } from '../memory/brief/embeddings.js';
import { observationToText, upsertEmbedding } from '../memory/brief/embed-store.js';

function toEpochMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function buildLastSessionBlock(last) {
  if (!last) return '';
  const summary = last.completed ?? last.title ?? last.request ?? '';
  const nextBit = last.nextSteps ? ` Next: ${last.nextSteps}.` : '';
  return `## Last Session\n${summary}.${nextBit}`;
}

function buildHistorySection(last, personaObs, persona) {
  const parts = [];
  const lastBlock = buildLastSessionBlock(last);
  if (lastBlock) parts.push(lastBlock);
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
export function createProjectHistoryStore(repo, { db = null, brief = null } = {}) {
  const briefEnabled = Boolean(brief?.enabled && db);
  const briefBudget = Number(brief?.budgetTokens) || 1000;

  function scheduleObservationEmbedding(items) {
    const batch = items
      .map(({ id, observation }) => ({ id, text: observationToText(observation) }))
      .filter((item) => item.text.length > 0);
    if (batch.length === 0) return;

    // Fire-and-forget: embedding shouldn't block ingest.
    Promise.resolve()
      .then(async () => {
        const { vectors, model: usedModel, dims } = await embedBatch(batch.map((b) => b.text));
        for (let i = 0; i < batch.length; i += 1) {
          upsertEmbedding(db, batch[i].id, vectors[i], { model: usedModel, dims });
        }
      })
      .catch((err) => {
        console.warn('[history] embedding new observations failed:', err.message);
      });
  }

  async function getLaunchHistory(projectId, persona, {
    summaryLimit = 1,
    observationLimit = 50,
    personaObservationLimit = 10,
    overrideObservationIds = null,
    customInstructions = null,
  } = {}) {
    const summaries = repo.listHistorySummaries({ projectId, limit: summaryLimit });
    const observations = repo.listHistoryObservations({ projectId, limit: observationLimit });
    const lastSummary = summaries[0] ?? null;
    const personaObservations = filterObservationsForPersona(observations, persona, {
      limit: personaObservationLimit,
    });

    let section = buildHistorySection(lastSummary, personaObservations, persona);
    let briefMeta = null;

    if (briefEnabled) {
      try {
        const result = Array.isArray(overrideObservationIds)
          ? buildManualBrief(db, overrideObservationIds)
          : await getPersonaBrief(db, {
              projectId,
              personaId: persona?.id ?? null,
              budgetTokens: briefBudget,
            });
        if (result.sourceCount > 0) {
          const parts = [];
          const lastBlock = buildLastSessionBlock(lastSummary);
          if (lastBlock) parts.push(lastBlock);
          parts.push(result.markdown);
          section = parts.join('\n\n');
          briefMeta = {
            enabled: true,
            markdown: result.markdown,
            usedTokens: result.usedTokens,
            budgetTokens: result.budgetTokens ?? briefBudget,
            sourceCount: result.sourceCount,
            observationIds: result.observationIds ?? [],
            manual: Array.isArray(overrideObservationIds),
          };
        }
      } catch (err) {
        console.warn('[history] brief generation failed; falling back to raw section:', err.message);
      }
    }

    const trimmedInstructions = typeof customInstructions === 'string' ? customInstructions.trim() : '';
    if (trimmedInstructions) {
      const userIntentBlock = `## User intent\n${trimmedInstructions}`;
      section = section ? `${section}\n\n${userIntentBlock}` : userIntentBlock;
    }

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
      section,
      brief: briefMeta,
      customInstructions: trimmedInstructions || null,
    };
  }

  function ingest({
    projectId,
    projectPath,
    historySessionId,
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

    let historySession = null;
    if (historySessionId != null) {
      historySession = repo.getHistorySession(Number(historySessionId));
      if (historySession && historySession.projectId !== project.id) {
        throw new Error('historySessionId belongs to a different project');
      }
    }
    if (!historySession && providerSessionId != null) {
      historySession = repo.getHistorySessionByProvider(providerId, providerSessionId);
    }

    if (!historySession) {
      const createdId = repo.createHistorySession({
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
      historySession = repo.getHistorySession(Number(createdId));
    } else {
      repo.updateHistorySession(historySession.id, {
        personaId: personaId != null ? Number(personaId) : historySession.personaId,
        providerSessionId: providerSessionId ?? historySession.providerSessionId,
        startedAt: startedAt ?? historySession.startedAt,
        endedAt,
        status,
        model,
        systemPrompt: historySession.systemPrompt ?? systemPrompt,
        source: historySession.source ?? source,
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

    const createdObservations = [];
    const observationIds = observations.map((observation) => {
      const id = Number(
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
      );
      createdObservations.push({ id, observation });
      return id;
    });

    if (briefEnabled && createdObservations.length > 0) {
      scheduleObservationEmbedding(createdObservations);
    }

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

  function createLaunch({
    projectId,
    personaId = null,
    providerId,
    providerSessionId = null,
    startedAt = new Date().toISOString(),
    status = 'in-progress',
    model = null,
    systemPrompt = null,
    source = 'launcher',
  }) {
    if (!projectId) throw new Error('projectId is required');
    if (!providerId) throw new Error('providerId is required');
    try {
      const id = repo.createHistorySession({
        projectId,
        personaId,
        providerId,
        providerSessionId,
        startedAt,
        status,
        model,
        systemPrompt,
        source,
      });
      return { historySessionId: Number(id) };
    } catch (err) {
      console.warn('[history] createLaunch failed:', err.message);
      return { historySessionId: null };
    }
  }

  function getDetail(historySessionId) {
    if (historySessionId == null) return null;
    return repo.getHistorySessionDetail(Number(historySessionId));
  }

  return {
    getLaunchHistory,
    ingest,
    listProjectHistory,
    createLaunch,
    getDetail,
  };
}
