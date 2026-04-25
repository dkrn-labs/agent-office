import { z } from 'zod';
import { route } from '../../frontdesk/runner.js';

const RouteRequestSchema = z.object({
  task: z.string({ message: 'task is required' }).trim().min(1, 'task is required'),
});

/**
 * Frontdesk router endpoint — rules-only in P1, becomes hybrid in P2.
 *
 * POST / (mounted at /api/frontdesk/route)
 * body: { task: string }
 *
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function frontdeskRoutes(deps = {}) {
  return async function plugin(fastify) {
    fastify.post('/', async (req, reply) => {
      const parsed = RouteRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? 'invalid request body';
        return reply.code(400).send({ data: null, error: message, meta: {} });
      }
      const { task } = parsed.data;
      try {
        const prefs = typeof deps.getPrefs === 'function' ? deps.getPrefs() : {};
        const signals = typeof deps.getSignals === 'function' ? deps.getSignals() : {};
        const result = await route(
          {
            repo: deps.repo,
            getActiveSessions: deps.getActiveSessions,
            getQuotaForProvider: deps.getQuotaForProvider,
            prefs,
            signals,
          },
          { task },
        );
        if (result.error) {
          return reply.code(400).send({ data: null, error: result.error, meta: {} });
        }
        return { data: result, error: null, meta: { stage: 'rules-only' } };
      } catch (err) {
        return reply.code(500).send({ data: null, error: err.message, meta: {} });
      }
    });
  };
}
