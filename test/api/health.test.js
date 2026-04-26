import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { healthRoutes } from '../../src/api/routes/health.js';

async function startApp(deps) {
  const app = Fastify();
  await app.register(healthRoutes(deps), { prefix: '/api/_health' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

async function get(app) {
  const port = app.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/_health`);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/_health', () => {
  it('returns 200 + healthy shape when DB pings', async () => {
    const app = await startApp({
      pingDb: () => true,
      version: '0.1.0',
      dataDir: '/tmp/ao',
    });
    try {
      const { status, body } = await get(app);
      assert.equal(status, 200);
      assert.equal(body.data.status, 'ok');
      assert.equal(body.data.db, 'reachable');
      assert.equal(body.data.version, '0.1.0');
      assert.equal(body.data.dataDir, '/tmp/ao');
      assert.equal(typeof body.data.uptime, 'number');
      assert.ok(body.data.uptime >= 0);
    } finally { await app.close(); }
  });

  it('returns 503 when DB ping fails', async () => {
    const app = await startApp({ pingDb: () => false });
    try {
      const { status, body } = await get(app);
      assert.equal(status, 503);
      assert.equal(body.data.status, 'degraded');
      assert.equal(body.data.db, 'unreachable');
    } finally { await app.close(); }
  });

  it('returns 503 when pingDb throws', async () => {
    const app = await startApp({ pingDb: () => { throw new Error('SQLITE_BUSY'); } });
    try {
      const { status, body } = await get(app);
      assert.equal(status, 503);
      assert.match(body.data.dbError, /SQLITE_BUSY/);
    } finally { await app.close(); }
  });
});
