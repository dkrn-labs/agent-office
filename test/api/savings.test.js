import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { savingsRoutes } from '../../src/api/routes/savings.js';

function app(repo) {
  const a = express();
  a.use('/api/savings', savingsRoutes({ repo }));
  return a;
}

async function get(server, path) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

function startServer(a) {
  return new Promise((resolve) => {
    const server = a.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('GET /api/savings', () => {
  it('returns empty rollup when no budget rows exist', async () => {
    const repo = { listLaunchBudgetsSince: () => [] };
    const server = await startServer(app(repo));
    try {
      const { status, body } = await get(server, '/api/savings?range=today');
      assert.equal(status, 200);
      assert.equal(body.error, null);
      assert.equal(body.data.range, 'today');
      assert.equal(body.data.sessions, 0);
      assert.equal(body.data.savedTokens, 0);
      assert.equal(body.data.savedPct, 0);
    } finally {
      server.close();
    }
  });

  it('rolls up real budget rows, outcome-weighted', async () => {
    const repo = {
      listLaunchBudgetsSince: () => ([
        { baselineTokens: 30000, optimizedTokens: 8000, costDollars: 0.10, outcome: 'accepted' },
        { baselineTokens: 25000, optimizedTokens: 7000, costDollars: 0.08, outcome: 'partial' },
        { baselineTokens: 20000, optimizedTokens: 6000, costDollars: 0.05, outcome: 'rejected' },
      ]),
    };
    const server = await startServer(app(repo));
    try {
      const { status, body } = await get(server, '/api/savings?range=d7');
      assert.equal(status, 200);
      assert.equal(body.data.sessions, 2, 'rejected excluded');
      assert.equal(body.data.baselineTokens, 30000 + 25000);
      assert.equal(body.data.optimizedTokens, 8000 + 7000);
      assert.equal(body.data.savedTokens, body.data.baselineTokens - body.data.optimizedTokens);
      assert.ok(body.data.savedPct > 0);
      assert.equal(body.meta.rowCount, 3);
    } finally {
      server.close();
    }
  });

  it('rejects unknown range with 400', async () => {
    const repo = { listLaunchBudgetsSince: () => [] };
    const server = await startServer(app(repo));
    try {
      const { status, body } = await get(server, '/api/savings?range=year');
      assert.equal(status, 400);
      assert.match(body.error, /unknown range/);
    } finally {
      server.close();
    }
  });

  it('defaults to today when range omitted', async () => {
    const repo = { listLaunchBudgetsSince: () => [] };
    const server = await startServer(app(repo));
    try {
      const { status, body } = await get(server, '/api/savings');
      assert.equal(status, 200);
      assert.equal(body.data.range, 'today');
    } finally {
      server.close();
    }
  });

  it('falls back gracefully when repo lacks the listLaunchBudgetsSince method', async () => {
    const server = await startServer(app({}));
    try {
      const { status, body } = await get(server, '/api/savings?range=today');
      assert.equal(status, 200);
      assert.equal(body.data.sessions, 0);
    } finally {
      server.close();
    }
  });
});
