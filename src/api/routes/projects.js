/**
 * @param {ReturnType<import('../../db/repository.js').createRepository>} repo
 * @param {import('better-sqlite3').Database} [db]
 * @param {{ syncIfStale?: (reason?: string) => Promise<void> }} [projectSync]
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function projectRoutes(repo, db = null, projectSync = null) {
  return async function plugin(fastify) {
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

    fastify.get('/api/projects', async () => {
      await projectSync?.syncIfStale?.('api-projects');
      return annotate(repo.listProjects());
    });

    fastify.get('/api/projects/active', async () => {
      await projectSync?.syncIfStale?.('api-projects-active');
      return annotate(repo.listProjects({ active: true }));
    });
  };
}
