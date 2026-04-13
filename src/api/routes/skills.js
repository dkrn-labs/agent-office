import { Router } from 'express';

/**
 * Returns an Express Router for skill endpoints.
 * @param {ReturnType<import('../../db/repository.js').createRepository>} repo
 * @returns {import('express').Router}
 */
export function skillRoutes(repo) {
  const router = Router();

  // GET /api/skills — list all skills
  router.get('/api/skills', (_req, res) => {
    const skills = repo.listSkills();
    res.json(skills);
  });

  return router;
}
