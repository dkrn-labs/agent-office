import { Router } from 'express';

/**
 * Returns an Express Router for project endpoints.
 * @param {ReturnType<import('../../db/repository.js').createRepository>} repo
 * @returns {import('express').Router}
 */
export function projectRoutes(repo) {
  const router = Router();

  // GET /api/projects — list all projects
  router.get('/api/projects', (_req, res) => {
    const projects = repo.listProjects();
    res.json(projects);
  });

  // GET /api/projects/active — list only active projects
  router.get('/api/projects/active', (_req, res) => {
    const projects = repo.listProjects({ active: true });
    res.json(projects);
  });

  return router;
}
