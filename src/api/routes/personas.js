/**
 * @param {ReturnType<import('../../db/repository.js').createRepository>} repo
 * @param {import('better-sqlite3').Database} [db]
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function personaRoutes(repo, db = null) {
  return async function plugin(fastify) {
    fastify.get('/api/personas', async () => repo.listPersonas());

    fastify.get('/api/projects/:projectId/personas/memory-stats', async (req, reply) => {
      if (!db) return { stats: [] };
      const projectId = Number(req.params.projectId);
      if (!Number.isInteger(projectId)) {
        return reply.code(400).send({ error: 'projectId must be an integer' });
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
      return {
        projectId,
        stats: rows.map((r) => ({
          personaId: r.personaId,
          observationCount: r.observationCount,
          providerCount: r.providerCount,
          lastActivityAt: r.lastActivityEpoch ? new Date(r.lastActivityEpoch).toISOString() : null,
        })),
      };
    });
  };
}
