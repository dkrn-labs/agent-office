import { Router } from 'express';
import { embed } from '../../memory/brief/embeddings.js';
import { searchSimilar } from '../../memory/brief/embed-store.js';

/**
 * Returns an Express Router for memory endpoints.
 *
 * @param {ReturnType<import('../../memory/memory-engine.js').createMemoryEngine>} memoryEngine
 * @param {import('../../db/repository.js').createRepository} repo
 * @param {typeof import('../../memory/claude-importer.js').importFromClaudeProjects} importer
 * @param {import('better-sqlite3').Database} [db]
 * @returns {import('express').Router}
 */
export function memoryRoutes(memoryEngine, repo, importer, db = null) {
  const router = Router();

  // GET /api/projects/:projectId/memories — list all memories for a project
  router.get('/api/projects/:projectId/memories', (req, res) => {
    const projectId = Number(req.params.projectId);
    const memories = memoryEngine.getProjectMemories(projectId);
    res.json(memories);
  });

  // POST /api/projects/:projectId/memories — create a memory
  router.post('/api/projects/:projectId/memories', (req, res) => {
    const projectId = Number(req.params.projectId);
    try {
      const memoryId = memoryEngine.create({ projectId, ...req.body });
      res.status(201).json({ memoryId });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /api/projects/:projectId/memories/stats — memory count stats
  router.get('/api/projects/:projectId/memories/stats', (req, res) => {
    const projectId = Number(req.params.projectId);
    const stats = memoryEngine.getStats(projectId);
    res.json(stats);
  });

  // GET /api/memory/search?q=&projectId=&personaId=&k=
  //   Semantic search over unified observations across all providers.
  router.get('/api/memory/search', async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Vector search unavailable' });
    const q = (req.query.q ?? '').toString().trim();
    if (!q) return res.status(400).json({ error: 'q is required' });

    const projectId = req.query.projectId != null ? Number(req.query.projectId) : undefined;
    const personaId = req.query.personaId != null ? Number(req.query.personaId) : undefined;
    const k = Math.min(50, Math.max(1, Number(req.query.k) || 10));

    try {
      const { vector } = await embed(q);
      const hits = searchSimilar(db, vector, { k, projectId, personaId });
      if (hits.length === 0) return res.json({ query: q, hits: [] });

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

      res.json({ query: q, hits: ordered });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/import/claude-memories — import from ~/.claude/projects
  router.post('/api/import/claude-memories', async (_req, res) => {
    try {
      const result = await importer(repo);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
