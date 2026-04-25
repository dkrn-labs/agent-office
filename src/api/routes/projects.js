import { Router } from 'express';

/**
 * Returns an Express Router for project endpoints.
 * @param {ReturnType<import('../../db/repository.js').createRepository>} repo
 * @param {import('better-sqlite3').Database} [db]  Optional handle for
 *   memory-stats aggregation. When provided, projects are returned with a
 *   `memoryStats` field so the picker can show observation depth.
 * @param {{ syncIfStale?: (reason?: string) => Promise<void> }} [projectSync]
 * @returns {import('express').Router}
 */
export function projectRoutes(repo, db = null, projectSync = null) {
  const router = Router();

  function collectMemoryStats() {
    if (!db) return new Map();
    const rows = db
      .prepare(
        `SELECT obs.project_id AS projectId,
                COUNT(*) AS observationCount,
                COUNT(meta.history_observation_id) AS embeddedCount,
                MAX(obs.created_at_epoch) AS lastActivityEpoch,
                COUNT(DISTINCT obs.provider_id) AS providerCount
         FROM history_observation obs
         LEFT JOIN observation_embedding_meta meta
           ON meta.history_observation_id = obs.history_observation_id
         GROUP BY obs.project_id`,
      )
      .all();
    return new Map(rows.map((r) => [r.projectId, r]));
  }

  function annotate(projects) {
    const stats = collectMemoryStats();
    return projects.map((p) => {
      const s = stats.get(p.id);
      return {
        ...p,
        memoryStats: s
          ? {
              observationCount: s.observationCount,
              embeddedCount: s.embeddedCount,
              providerCount: s.providerCount,
              lastActivityAt: s.lastActivityEpoch ? new Date(s.lastActivityEpoch).toISOString() : null,
            }
          : { observationCount: 0, embeddedCount: 0, providerCount: 0, lastActivityAt: null },
      };
    });
  }

  // GET /api/projects — list all projects
  router.get('/api/projects', async (_req, res, next) => {
    try {
      await projectSync?.syncIfStale?.('api-projects');
    } catch (err) {
      return next(err);
    }
    res.json(annotate(repo.listProjects()));
  });

  // GET /api/projects/active — list only active projects
  router.get('/api/projects/active', async (_req, res, next) => {
    try {
      await projectSync?.syncIfStale?.('api-projects-active');
    } catch (err) {
      return next(err);
    }
    res.json(annotate(repo.listProjects({ active: true })));
  });

  return router;
}
