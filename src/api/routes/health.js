import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let DEFAULT_VERSION = '0.0.0';
try {
  const pkg = require(join(__dirname, '../../../package.json'));
  DEFAULT_VERSION = pkg.version ?? '0.0.0';
} catch {}

/**
 * GET /api/_health — liveness + readiness, single endpoint.
 *
 * Healthy = process is up + DB pings. The docker-compose
 * `healthcheck:` directive (P6) binds to this; load balancers and
 * uptime monitors do too. 200 healthy / 503 degraded.
 *
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function healthRoutes({ pingDb, version, dataDir } = {}) {
  const startedAt = Date.now();
  const ver = version ?? DEFAULT_VERSION;
  return async function plugin(fastify) {
    fastify.get('/', async (_req, reply) => {
      let dbReachable = false;
      let dbError = null;
      try {
        dbReachable = typeof pingDb === 'function' ? !!pingDb() : true;
      } catch (err) {
        dbReachable = false;
        dbError = err?.message ?? String(err);
      }
      const data = {
        status: dbReachable ? 'ok' : 'degraded',
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        version: ver,
        db: dbReachable ? 'reachable' : 'unreachable',
        dataDir: dataDir ?? null,
      };
      if (dbError) data.dbError = dbError;
      return reply.code(dbReachable ? 200 : 503).send({ data, error: null, meta: {} });
    });
  };
}
