import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { frontdeskRoutes } from '../../src/api/routes/frontdesk.js';

function buildApp(deps) {
  const a = express();
  a.use(express.json());
  a.use('/api/frontdesk/route', frontdeskRoutes(deps));
  return a;
}

async function startServer(a) {
  return new Promise((resolve) => {
    const s = a.listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function post(server, path, body) {
  const port = server.address().port;
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
    const server = await startServer(buildApp({ repo: fakeRepo, getPrefs: () => ({}) }));
    try {
      const { status, body } = await post(server, '/api/frontdesk/route', {});
      assert.equal(status, 400);
      assert.match(body.error, /task is required/i);
    } finally {
      server.close();
    }
  });

  it('returns Candidates with rulesApplied trace + a pick', async () => {
    const server = await startServer(buildApp({ repo: fakeRepo, getPrefs: () => ({}) }));
    try {
      const { status, body } = await post(server, '/api/frontdesk/route', {
        task: 'fix the gemini hook in agent-office',
      });
      assert.equal(status, 200);
      assert.equal(body.error, null);
      assert.ok(body.data.candidates);
      assert.ok(Array.isArray(body.data.candidates.rulesApplied));
      // R13 always fires; debug bias should put Debug Specialist first
      assert.ok(body.data.candidates.rulesApplied.includes('R13'));
      assert.equal(body.data.pick.persona.domain, 'debug');
    } finally {
      server.close();
    }
  });

  it('blocks gracefully when secrets+strict and no local model loaded', async () => {
    const server = await startServer(buildApp({
      repo: fakeRepo,
      getPrefs: () => ({ privacyMode: 'strict', localModelLoaded: false }),
    }));
    try {
      const { status, body } = await post(server, '/api/frontdesk/route', {
        task: 'rotate the password',
      });
      assert.equal(status, 200);
      assert.match(body.data.candidates.constraints.blockedReason, /no local model/i);
      assert.equal(body.data.pick, null);
    } finally {
      server.close();
    }
  });
});
