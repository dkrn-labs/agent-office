import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { frontdeskRoutes } from '../../src/api/routes/frontdesk.js';

async function startApp(deps) {
  const app = Fastify();
  await app.register(frontdeskRoutes(deps), { prefix: '/api/frontdesk/route' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

async function post(app, path, body) {
  const port = app.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const fakeRepo = {
  listPersonas: () => [
    { id: 1, label: 'Frontend Engineer', domain: 'frontend', secondaryDomains: [] },
    { id: 2, label: 'Debug Specialist', domain: 'debug', secondaryDomains: [] },
    { id: 6, label: 'Frontdesk', domain: 'router', secondaryDomains: [] },
  ],
  listProjects: () => [{ id: 100, name: 'agent-office', path: '/x' }],
};

describe('POST /api/frontdesk/route', () => {
  it('400s when task is missing', async () => {
    const app = await startApp({ repo: fakeRepo, getPrefs: () => ({}) });
    try {
      const { status, body } = await post(app, '/api/frontdesk/route', {});
      assert.equal(status, 400);
      assert.match(body.error, /task is required/i);
    } finally {
      await app.close();
    }
  });

  it('returns Candidates with rulesApplied trace + a pick', async () => {
    const app = await startApp({ repo: fakeRepo, getPrefs: () => ({}) });
    try {
      const { status, body } = await post(app, '/api/frontdesk/route', {
        task: 'fix the gemini hook in agent-office',
      });
      assert.equal(status, 200);
      assert.equal(body.error, null);
      assert.ok(body.data.candidates);
      assert.ok(Array.isArray(body.data.candidates.rulesApplied));
      assert.ok(body.data.candidates.rulesApplied.includes('R13'));
      assert.equal(body.data.pick.persona.domain, 'debug');
    } finally {
      await app.close();
    }
  });

  it('blocks gracefully when secrets+strict and no local model loaded', async () => {
    const app = await startApp({
      repo: fakeRepo,
      getPrefs: () => ({ privacyMode: 'strict', localModelLoaded: false }),
    });
    try {
      const { status, body } = await post(app, '/api/frontdesk/route', {
        task: 'rotate the password',
      });
      assert.equal(status, 200);
      assert.match(body.data.candidates.constraints.blockedReason, /local backend is unreachable|no local provider/i);
      assert.equal(body.data.pick, null);
    } finally {
      await app.close();
    }
  });
});
