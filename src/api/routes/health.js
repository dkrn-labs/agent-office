import { Router } from 'express';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Read version from package.json at the project root (three levels up from src/api/routes)
let version = '0.0.0';
try {
  const pkg = require(join(__dirname, '../../../package.json'));
  version = pkg.version ?? '0.0.0';
} catch {
  // Leave default if package.json unreadable
}

const startTime = Date.now();

/**
 * Returns an Express Router for health-check endpoints.
 * @returns {import('express').Router}
 */
export function healthRoutes() {
  const router = Router();

  router.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version,
    });
  });

  return router;
}
