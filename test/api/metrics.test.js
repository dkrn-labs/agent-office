import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { metricsRoutes } from '../../src/api/routes/metrics.js';

async function startApp(deps) {
  const app = Fastify();
  await app.register(metricsRoutes(deps), { prefix: '/api/_metrics' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

async function get(app, qs = '') {
  const port = app.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/_metrics${qs}`);
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, body, contentType: ct };
}

const ZERO_DEPS = {
  countLiveSessions: () => ({ live: 0, byProvider: {} }),
  countFrontdeskDecisions: () => ({ today: 0, fallbackRate7d: 0 }),
  rollupSavingsToday: () => ({ savedDollarsToday: 0, savedTokens7d: 0 }),
  abtopState: () => ({ reachable: false, lastTickEpoch: null }),
  watcherStats: () => ({ claude: { sessionsTracked: 0 }, codex: { sessionsTracked: 0 }, gemini: { sessionsTracked: 0 } }),
};

describe('GET /api/_metrics', () => {
  it('returns the documented JSON shape with zeroes when nothing is happening', async () => {
    const app = await startApp(ZERO_DEPS);
    try {
      const { status, body } = await get(app);
      assert.equal(status, 200);
      assert.ok(body.data.sessions);
      assert.ok(body.data.frontdesk);
      assert.ok(body.data.savings);
      assert.ok(body.data.abtop);
      assert.ok(body.data.watchers);
      assert.equal(body.data.sessions.live, 0);
      assert.equal(body.data.abtop.reachable, false);
    } finally { await app.close(); }
  });

  it('reflects injected counts', async () => {
    const app = await startApp({
      ...ZERO_DEPS,
      countLiveSessions: () => ({ live: 3, byProvider: { 'claude-code': 2, codex: 1 } }),
      countFrontdeskDecisions: () => ({ today: 7, fallbackRate7d: 0.04 }),
    });
    try {
      const { body } = await get(app);
      assert.equal(body.data.sessions.live, 3);
      assert.equal(body.data.sessions.byProvider['claude-code'], 2);
      assert.equal(body.data.frontdesk.today, 7);
    } finally { await app.close(); }
  });

  it('serves Prometheus text format when ?format=prometheus', async () => {
    const app = await startApp({
      ...ZERO_DEPS,
      countLiveSessions: () => ({ live: 5, byProvider: { 'claude-code': 5 } }),
    });
    try {
      const { status, body, contentType } = await get(app, '?format=prometheus');
      assert.equal(status, 200);
      assert.match(contentType, /text\/plain/);
      assert.match(body, /^# HELP agent_office_sessions_live/m);
      assert.match(body, /^agent_office_sessions_live\s+5/m);
      assert.match(body, /^agent_office_sessions_by_provider\{provider="claude-code"\}\s+5/m);
    } finally { await app.close(); }
  });

  it('does not crash when a dep getter throws — degrades gracefully', async () => {
    const app = await startApp({
      ...ZERO_DEPS,
      countLiveSessions: () => { throw new Error('repo down'); },
    });
    try {
      const { status, body } = await get(app);
      assert.equal(status, 200);
      // The crashed getter's slot reports null; the rest is intact.
      assert.equal(body.data.sessions, null);
      assert.equal(body.data.abtop.reachable, false);
    } finally { await app.close(); }
  });
});
