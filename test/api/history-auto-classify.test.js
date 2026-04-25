import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { historyRoutes } from '../../src/api/routes/history.js';

async function startApp({ historyStore, repo }) {
  const app = Fastify();
  await app.register(historyRoutes(historyStore, { repo }));
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

const fakeIngestResult = {
  historySession: { id: 42, projectId: 1 },
  project: { id: 1 },
  summaryId: 1,
  observationIds: [101, 102],
};

const baseRequest = {
  providerId: 'claude-code',
  projectPath: '/tmp/x',
  status: 'completed',
  summary: { summaryKind: 'turn', completed: 'did the thing' },
};

describe('POST /api/history/ingest — P1-6 auto-classify', () => {
  it("default-classifies hook-completed sessions as 'accepted' when no outcome exists", async () => {
    const calls = [];
    const repo = {
      setLaunchBudgetOutcome: (id, outcome) => calls.push(['ledger', id, outcome]),
      upsertHistorySessionMetrics: (id, fields) => calls.push(['metrics', id, fields]),
      getHistorySessionMetrics: () => null,
    };
    const historyStore = { ingest: () => fakeIngestResult };
    const app = await startApp({ historyStore, repo });
    try {
      const { status } = await post(app, '/api/history/ingest', baseRequest);
      assert.equal(status, 200);
      assert.deepEqual(calls, [
        ['ledger', 42, 'accepted'],
        ['metrics', 42, { outcome: 'accepted' }],
      ]);
    } finally {
      await app.close();
    }
  });

  it('does NOT overwrite an existing outcome (operator override / inferOutcome wins)', async () => {
    const calls = [];
    const repo = {
      setLaunchBudgetOutcome: (id, outcome) => calls.push(['ledger', id, outcome]),
      upsertHistorySessionMetrics: (id, fields) => calls.push(['metrics', id, fields]),
      getHistorySessionMetrics: () => ({ outcome: 'partial' }),
    };
    const historyStore = { ingest: () => fakeIngestResult };
    const app = await startApp({ historyStore, repo });
    try {
      const { status } = await post(app, '/api/history/ingest', baseRequest);
      assert.equal(status, 200);
      assert.deepEqual(calls, [], 'no outcome writes when one already exists');
    } finally {
      await app.close();
    }
  });

  it('skips classification when status is not "completed"', async () => {
    const calls = [];
    const repo = {
      setLaunchBudgetOutcome: () => calls.push('ledger'),
      upsertHistorySessionMetrics: () => calls.push('metrics'),
      getHistorySessionMetrics: () => null,
    };
    const historyStore = { ingest: () => fakeIngestResult };
    const app = await startApp({ historyStore, repo });
    try {
      const { status } = await post(app, '/api/history/ingest', { ...baseRequest, status: 'in-progress' });
      assert.equal(status, 200);
      assert.deepEqual(calls, []);
    } finally {
      await app.close();
    }
  });

  it('does not crash when repo lacks the setLaunchBudgetOutcome method', async () => {
    const repo = {};
    const historyStore = { ingest: () => fakeIngestResult };
    const app = await startApp({ historyStore, repo });
    try {
      const { status, body } = await post(app, '/api/history/ingest', baseRequest);
      assert.equal(status, 200);
      assert.equal(body.error, null);
    } finally {
      await app.close();
    }
  });
});
