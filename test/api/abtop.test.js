import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { abtopRoutes } from '../../src/api/routes/abtop.js';

async function startApp(getBridge) {
  const app = Fastify();
  await app.register(abtopRoutes({ getBridge }), { prefix: '/api/abtop' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

async function get(app, path) {
  const port = app.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/abtop/snapshot', () => {
  it('returns the bridge snapshot when wired', async () => {
    const fakeBridge = { snapshot: () => ({ totalSessions: 1, sessions: [{ pid: 1, model: 'opus' }] }) };
    const app = await startApp(() => fakeBridge);
    try {
      const { status, body } = await get(app, '/api/abtop/snapshot');
      assert.equal(status, 200);
      assert.equal(body.data.totalSessions, 1);
      assert.equal(body.data.sessions[0].pid, 1);
      assert.equal(body.meta.source, 'abtop');
    } finally {
      await app.close();
    }
  });

  it('returns an empty snapshot when no bridge is wired', async () => {
    const app = await startApp(() => null);
    try {
      const { body } = await get(app, '/api/abtop/snapshot');
      assert.equal(body.data.totalSessions, 0);
      assert.deepEqual(body.data.sessions, []);
      assert.equal(body.meta.source, 'no-bridge');
    } finally {
      await app.close();
    }
  });
});
