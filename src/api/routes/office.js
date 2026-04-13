import { Router } from 'express';

/**
 * Returns an Express Router for office endpoints.
 * @param {ReturnType<import('../../agents/launcher.js').createLauncher>} launcher
 * @returns {import('express').Router}
 */
export function officeRoutes(launcher) {
  const router = Router();

  // POST /api/office/launch — prepare and launch a persona session
  router.post('/api/office/launch', async (req, res) => {
    const { personaId, projectId } = req.body ?? {};

    if (personaId == null || projectId == null) {
      return res.status(400).json({ error: 'personaId and projectId are required' });
    }

    try {
      const { sessionId } = await launcher.prepareLaunch(
        Number(personaId),
        Number(projectId),
      );
      res.json({ sessionId });
    } catch (err) {
      const status = err.message?.startsWith('Persona not found') ||
        err.message?.startsWith('Project not found') ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  return router;
}
