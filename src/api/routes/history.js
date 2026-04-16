import { Router } from 'express';

function ok(res, data, meta = {}) {
  return res.json({ data, error: null, meta });
}

function fail(res, status, message, meta = {}) {
  return res.status(status).json({ data: null, error: message, meta });
}

function parseProjectId(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Routes for provider-neutral project history ingestion and inspection.
 *
 * @param {ReturnType<import('../../history/project-history.js').createProjectHistoryStore>} historyStore
 * @returns {import('express').Router}
 */
export function historyRoutes(historyStore) {
  const router = Router();

  router.get('/api/projects/:projectId/history', (req, res) => {
    const projectId = parseProjectId(req.params.projectId);
    if (projectId == null) {
      return fail(res, 400, 'projectId must be a positive integer');
    }

    const summaries = parseProjectId(req.query.summaryLimit) ?? 10;
    const observations = parseProjectId(req.query.observationLimit) ?? 25;
    const data = historyStore.listProjectHistory(projectId, {
      summaryLimit: summaries,
      observationLimit: observations,
    });
    return ok(res, data, { projectId });
  });

  router.post('/api/history/ingest', (req, res) => {
    const payload = req.body ?? {};
    if (!payload.providerId) {
      return fail(res, 400, 'providerId is required');
    }
    if (payload.projectId == null && !payload.projectPath) {
      return fail(res, 400, 'projectId or projectPath is required');
    }
    if (!payload.summary && (!Array.isArray(payload.observations) || payload.observations.length === 0)) {
      return fail(res, 400, 'summary or observations is required');
    }

    try {
      const result = historyStore.ingest({
        projectId: payload.projectId,
        projectPath: payload.projectPath,
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

      return ok(
        res,
        {
          historySessionId: result.historySession.id,
          projectId: result.project.id,
          summaryId: result.summaryId,
          observationCount: result.observationIds.length,
        },
        { providerId: payload.providerId },
      );
    } catch (err) {
      const status = err.message === 'Project not found' ? 404 : 400;
      return fail(res, status, err.message);
    }
  });

  return router;
}
