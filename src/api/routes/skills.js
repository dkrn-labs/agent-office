import { Router } from 'express';

/**
 * Returns an Express Router for skill endpoints.
 * @param {ReturnType<import('../../db/repository.js').createRepository>} repo
 * @param {ReturnType<import('../../agents/skill-resolver.js').createSkillResolver>} resolver
 * @returns {import('express').Router}
 */
export function skillRoutes(repo, resolver) {
  const router = Router();

  // GET /api/skills — list all skills
  router.get('/api/skills', (req, res) => {
    const { personaId, projectId } = req.query ?? {};
    if (personaId != null && projectId != null) {
      const persona = repo.getPersona(Number(personaId));
      const project = repo.getProject(Number(projectId));
      if (!persona || !project) {
        return res.status(404).json({ error: 'Persona or project not found' });
      }
      return res.json(resolver.inventoryForLaunch(persona, project));
    }

    const skills = repo.listSkills();
    res.json(skills);
  });

  return router;
}
