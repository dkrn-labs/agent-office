import { Router } from 'express';

/**
 * Returns an Express Router for office endpoints.
 * @param {ReturnType<import('../../agents/launcher.js').createLauncher>} launcher
 * @returns {import('express').Router}
 */
export function officeRoutes(launcher) {
  const router = Router();

  function parseIdList(value) {
    if (value == null) return null;
    if (Array.isArray(value)) return value.map((n) => Number(n)).filter(Number.isInteger);
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((n) => Number(n.trim()))
        .filter(Number.isInteger);
    }
    return null;
  }

  // GET /api/office/preview — return the context that would be injected on launch
  router.get('/api/office/preview', async (req, res) => {
    const { personaId, projectId, providerId, model, selectedObservationIds, customInstructions } = req.query ?? {};

    if (personaId == null || projectId == null) {
      return res.status(400).json({ error: 'personaId and projectId are required' });
    }

    try {
      const preview = await launcher.preview(Number(personaId), Number(projectId), {
        providerId: providerId ?? undefined,
        model: model ?? undefined,
        selectedObservationIds: parseIdList(selectedObservationIds),
        customInstructions: customInstructions ?? null,
      });
      res.json(preview);
    } catch (err) {
      const status =
        err.message?.startsWith('Persona not found') ||
        err.message?.startsWith('Project not found')
          ? 404
          : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // POST /api/office/launch — assemble context, create session, emit event, spawn iTerm
  router.post('/api/office/launch', async (req, res) => {
    const { personaId, projectId, providerId, model, selectedObservationIds, customInstructions } = req.body ?? {};

    if (personaId == null || projectId == null) {
      return res.status(400).json({ error: 'personaId and projectId are required' });
    }

    try {
      const ctx = await launcher.launch(Number(personaId), Number(projectId), {
        providerId: providerId ?? undefined,
        model: model ?? undefined,
        selectedObservationIds: Array.isArray(selectedObservationIds)
          ? selectedObservationIds.map((n) => Number(n)).filter(Number.isInteger)
          : null,
        customInstructions: customInstructions ?? null,
      });
      res.json({ sessionId: ctx.sessionId });
    } catch (err) {
      const status =
        err.message?.startsWith('Persona not found') ||
        err.message?.startsWith('Project not found')
          ? 404
          : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // GET /api/office/memory-candidates — last N persona-scoped observations +
  // the IDs the auto-brief would pick (used to default-check Step 3 of the
  // launch wizard).
  router.get('/api/office/memory-candidates', async (req, res) => {
    const { personaId, projectId, limit } = req.query ?? {};
    if (personaId == null || projectId == null) {
      return res.status(400).json({ error: 'personaId and projectId are required' });
    }
    try {
      const data = await launcher.memoryCandidates(Number(personaId), Number(projectId), {
        limit: limit != null ? Number(limit) : 10,
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
