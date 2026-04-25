/**
 * Quota stub. Real per-provider 5h/7d remaining + reset times land in P4
 * when abtop-bridge is wired. Until then this returns an empty per-provider
 * map so the UI can render its quota cells without 404s.
 *
 * GET /api/quota
 *
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function quotaRoutes() {
  return async function plugin(fastify) {
    fastify.get('/api/quota', async () => ({
      data: {
        providers: {
          'claude-code': null,
          codex: null,
          'gemini-cli': null,
        },
        source: 'stub',
      },
      error: null,
      meta: { note: 'P4 wires abtop-bridge for real quota signals' },
    }));
  };
}
