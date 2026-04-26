/**
 * Abtop snapshot route. Bootstrap path for the dashboard timeline; the
 * ws-bus delivers per-session deltas via session:detail:tick.
 *
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function abtopRoutes({ getBridge } = {}) {
  return async function plugin(fastify) {
    fastify.get('/snapshot', async () => {
      const bridge = typeof getBridge === 'function' ? getBridge() : null;
      if (!bridge) {
        return { data: { totalSessions: 0, sessions: [] }, error: null, meta: { source: 'no-bridge' } };
      }
      return { data: bridge.snapshot(), error: null, meta: { source: 'abtop' } };
    });
  };
}
