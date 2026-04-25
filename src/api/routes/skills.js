/**
 * @param {ReturnType<import('../../db/repository.js').createRepository>} repo
 * @param {ReturnType<import('../../agents/skill-resolver.js').createSkillResolver>} resolver
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function skillRoutes(repo, resolver) {
  return async function plugin(fastify) {
    fastify.get('/api/skills', async (req, reply) => {
      const { personaId, projectId } = req.query ?? {};
      if (personaId != null && projectId != null) {
        const persona = repo.getPersona(Number(personaId));
        const project = repo.getProject(Number(projectId));
        if (!persona || !project) {
          return reply.code(404).send({ error: 'Persona or project not found' });
        }
        return resolver.inventoryForLaunch(persona, project);
      }
      return repo.listSkills();
    });
  };
}
