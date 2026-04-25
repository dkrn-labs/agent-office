import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let version = '0.0.0';
try {
  const pkg = require(join(__dirname, '../../../package.json'));
  version = pkg.version ?? '0.0.0';
} catch {}

const startTime = Date.now();

/**
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function healthRoutes() {
  return async function plugin(fastify) {
    fastify.get('/api/health', async () => ({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version,
    }));
  };
}
