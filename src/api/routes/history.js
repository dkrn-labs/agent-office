function parseProjectId(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseBool(value) {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return value === '1' || value.toLowerCase() === 'true';
}

/**
 * @param {ReturnType<import('../../history/project-history.js').createProjectHistoryStore>} historyStore
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function historyRoutes(historyStore, { repo } = {}) {
  return async function plugin(fastify) {
    fastify.get('/api/history/sessions', async (req, reply) => {
      if (!repo) {
        return reply.code(500).send({ data: null, error: 'repo not wired into historyRoutes', meta: {} });
      }
      const { page, pageSize, personaId, projectId, source } = req.query ?? {};
      const unassigned = parseBool(req.query?.unassigned) || source === 'unassigned';
      return repo.listHistorySessionsPage({ page, pageSize, personaId, projectId, source, unassigned });
    });

    fastify.get('/api/history/sessions/:id', async (req, reply) => {
      if (!repo) {
        return reply.code(500).send({ data: null, error: 'repo not wired into historyRoutes', meta: {} });
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ data: null, error: 'id must be a positive integer', meta: {} });
      }
      const detail = repo.getHistorySessionWithContext(id);
      if (!detail) return reply.code(404).send({ data: null, error: 'History session not found', meta: {} });
      return detail;
    });

    fastify.get('/api/projects/:projectId/history', async (req, reply) => {
      const projectId = parseProjectId(req.params.projectId);
      if (projectId == null) {
        return reply.code(400).send({ data: null, error: 'projectId must be a positive integer', meta: {} });
      }
      const summaries = parseProjectId(req.query.summaryLimit) ?? 10;
      const observations = parseProjectId(req.query.observationLimit) ?? 25;
      const data = historyStore.listProjectHistory(projectId, {
        summaryLimit: summaries,
        observationLimit: observations,
      });
      return { data, error: null, meta: { projectId } };
    });

    fastify.post('/api/history/ingest', async (req, reply) => {
      const payload = req.body ?? {};
      if (!payload.providerId) {
        return reply.code(400).send({ data: null, error: 'providerId is required', meta: {} });
      }
      if (payload.projectId == null && !payload.projectPath) {
        return reply.code(400).send({ data: null, error: 'projectId or projectPath is required', meta: {} });
      }
      if (!payload.summary && (!Array.isArray(payload.observations) || payload.observations.length === 0)) {
        return reply.code(400).send({ data: null, error: 'summary or observations is required', meta: {} });
      }

      try {
        const result = historyStore.ingest({
          projectId: payload.projectId,
          projectPath: payload.projectPath,
          historySessionId: payload.historySessionId,
          personaId: payload.personaId,
          providerId: payload.providerId,
          providerSessionId: payload.providerSessionId,
          startedAt: payload.startedAt,
          endedAt: payload.endedAt,
          status: payload.status,
          model: payload.model,
          systemPrompt: payload.systemPrompt,
          source: payload.source,
          summary: payload.summary,
          observations: Array.isArray(payload.observations) ? payload.observations : [],
        });

        // P1-6 — default-classify hook-completed sessions as 'accepted'.
        if (
          payload.status === 'completed' &&
          repo &&
          typeof repo.setLaunchBudgetOutcome === 'function'
        ) {
          try {
            const sessionId = result.historySession.id;
            const existing = typeof repo.getHistorySessionMetrics === 'function'
              ? repo.getHistorySessionMetrics(sessionId)
              : null;
            if (!existing?.outcome) {
              repo.setLaunchBudgetOutcome(sessionId, 'accepted');
              if (typeof repo.upsertHistorySessionMetrics === 'function') {
                repo.upsertHistorySessionMetrics(sessionId, { outcome: 'accepted' });
              }
            }
          } catch {}
        }

        return {
          data: {
            historySessionId: result.historySession.id,
            projectId: result.project.id,
            summaryId: result.summaryId,
            observationCount: result.observationIds.length,
          },
          error: null,
          meta: { providerId: payload.providerId },
        };
      } catch (err) {
        const status = err.message === 'Project not found' ? 404 : 400;
        return reply.code(status).send({ data: null, error: err.message, meta: {} });
      }
    });
  };
}
