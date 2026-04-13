import { Router } from 'express';

/**
 * Returns an Express Router for memory endpoints.
 *
 * @param {ReturnType<import('../../memory/memory-engine.js').createMemoryEngine>} memoryEngine
 * @param {import('../../db/repository.js').createRepository} repo
 * @param {typeof import('../../memory/claude-importer.js').importFromClaudeProjects} importer
 * @returns {import('express').Router}
 */
export function memoryRoutes(memoryEngine, repo, importer) {
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
