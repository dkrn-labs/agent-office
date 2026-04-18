import { Router } from 'express';

/**
 * Returns an Express Router for persona endpoints.
 * @param {ReturnType<import('../../db/repository.js').createRepository>} repo
 * @param {import('better-sqlite3').Database} [db]
 * @returns {import('express').Router}
 */
export function personaRoutes(repo, db = null) {
  const router = Router();

  // GET /api/personas — list all personas
  router.get('/api/personas', (_req, res) => {
    res.json(repo.listPersonas());
  });

  // GET /api/projects/:projectId/personas/memory-stats
  //   Observation count + last-activity per persona for one project.
  router.get('/api/projects/:projectId/personas/memory-stats', (req, res) => {
    if (!db) {
      return res.json({ stats: [] });
    }
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ error: 'projectId must be an integer' });
    }
    const rows = db
      .prepare(
        `SELECT sess.persona_id AS personaId,
                COUNT(*) AS observationCount,
                MAX(obs.created_at_epoch) AS lastActivityEpoch,
                COUNT(DISTINCT obs.provider_id) AS providerCount
         FROM history_observation obs
         JOIN history_session sess ON sess.history_session_id = obs.history_session_id
         WHERE obs.project_id = ? AND sess.persona_id IS NOT NULL
         GROUP BY sess.persona_id`,
      )
      .all(projectId);
    res.json({
      projectId,
      stats: rows.map((r) => ({
        personaId: r.personaId,
        observationCount: r.observationCount,
        providerCount: r.providerCount,
        lastActivityAt: r.lastActivityEpoch ? new Date(r.lastActivityEpoch).toISOString() : null,
      })),
    });
  });

  return router;
}
