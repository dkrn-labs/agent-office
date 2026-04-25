import { embed } from '../../memory/brief/embeddings.js';
import { searchSimilar } from '../../memory/brief/embed-store.js';

/**
 * @param {ReturnType<import('../../memory/memory-engine.js').createMemoryEngine>} memoryEngine
 * @param {ReturnType<import('../../db/repository.js').createRepository>} repo
 * @param {typeof import('../../memory/claude-importer.js').importFromClaudeProjects} importer
 * @param {import('better-sqlite3').Database} [db]
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function memoryRoutes(memoryEngine, repo, importer, db = null) {
  return async function plugin(fastify) {
    fastify.get('/api/projects/:projectId/memories', async (req) => {
      const projectId = Number(req.params.projectId);
      return memoryEngine.getProjectMemories(projectId);
    });

    fastify.post('/api/projects/:projectId/memories', async (req, reply) => {
      const projectId = Number(req.params.projectId);
      try {
        const memoryId = memoryEngine.create({ projectId, ...req.body });
        return reply.code(201).send({ memoryId });
      } catch (err) {
        return reply.code(400).send({ error: err.message });
      }
    });

    fastify.get('/api/projects/:projectId/memories/stats', async (req) => {
      const projectId = Number(req.params.projectId);
      return memoryEngine.getStats(projectId);
    });

    fastify.get('/api/memory/search', async (req, reply) => {
      if (!db) return reply.code(503).send({ error: 'Vector search unavailable' });
      const q = (req.query.q ?? '').toString().trim();
      if (!q) return reply.code(400).send({ error: 'q is required' });

      const projectId = req.query.projectId != null ? Number(req.query.projectId) : undefined;
      const personaId = req.query.personaId != null ? Number(req.query.personaId) : undefined;
      const k = Math.min(50, Math.max(1, Number(req.query.k) || 10));

      try {
        const { vector } = await embed(q);
        const hits = searchSimilar(db, vector, { k, projectId, personaId });
        if (hits.length === 0) return { query: q, hits: [] };

        const placeholders = hits.map(() => '?').join(',');
        const rows = db
          .prepare(
            `SELECT obs.history_observation_id AS id,
                    obs.project_id AS projectId,
                    obs.provider_id AS providerId,
                    sess.persona_id AS personaId,
                    obs.type, obs.title, obs.subtitle, obs.narrative,
                    obs.created_at AS createdAt
             FROM history_observation obs
             JOIN history_session sess ON sess.history_session_id = obs.history_session_id
             WHERE obs.history_observation_id IN (${placeholders})`,
          )
          .all(...hits.map((h) => h.observationId));

        const byId = new Map(rows.map((r) => [r.id, r]));
        const ordered = hits
          .map((h) => ({ ...byId.get(h.observationId), distance: h.distance }))
          .filter((row) => row.id != null);

        return { query: q, hits: ordered };
      } catch (err) {
        return reply.code(500).send({ error: err.message });
      }
    });

    fastify.post('/api/import/claude-memories', async (_req, reply) => {
      try {
        return await importer(repo);
      } catch (err) {
        return reply.code(500).send({ error: err.message });
      }
    });
  };
}
