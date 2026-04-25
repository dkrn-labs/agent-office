export function portfolioRoutes(portfolioStats) {
  return async function plugin(fastify) {
    fastify.get('/api/portfolio/stats', async (req, reply) => {
      const force = req.query?.refresh === '1';
      try {
        return await portfolioStats.getAll({ force });
      } catch (err) {
        return reply.code(500).send({ error: err.message ?? 'Failed to compute portfolio stats' });
      }
    });
  };
}
