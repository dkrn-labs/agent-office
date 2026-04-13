import { Router } from 'express';

/**
 * Returns an Express Router for persona endpoints.
 * @param {ReturnType<import('../../db/repository.js').createRepository>} repo
 * @returns {import('express').Router}
 */
export function personaRoutes(repo) {
  const router = Router();

  // GET /api/personas — list all personas
  router.get('/api/personas', (_req, res) => {
    const personas = repo.listPersonas();
    res.json(personas);
  });

  return router;
}
