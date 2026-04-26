import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { savingsRoutes } from '../../src/api/routes/savings.js';

async function startApp(repo) {
  const app = Fastify();
  await app.register(savingsRoutes({ repo }), { prefix: '/api/savings' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

async function get(app, path) {
  const port = app.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/savings — breakdown.cloud + breakdown.local', () => {
  it('splits sessions by provider kind and credits cloudEquivalent for local rows', async () => {
    // Two cloud sessions (claude-code, codex), two local (aider-local), one rejected local.
    const rows = [
      { providerId: 'claude-code', baselineTokens: 30000, optimizedTokens: 8000, costDollars: 0.20, cloudEquivalentDollars: null,  outcome: 'accepted' },
      { providerId: 'codex',       baselineTokens: 22000, optimizedTokens: 7000, costDollars: 0.10, cloudEquivalentDollars: null,  outcome: 'accepted' },
      { providerId: 'aider-local', baselineTokens: 12000, optimizedTokens: 4000, costDollars: 0,    cloudEquivalentDollars: 0.05,  outcome: 'accepted' },
      { providerId: 'aider-local', baselineTokens: 14000, optimizedTokens: 4500, costDollars: 0,    cloudEquivalentDollars: 0.07,  outcome: 'partial' },
      { providerId: 'aider-local', baselineTokens: 99999, optimizedTokens:  100, costDollars: 0,    cloudEquivalentDollars: 9.99,  outcome: 'rejected' },
    ];
    const repo = { listLaunchBudgetsSince: () => rows };
    const app = await startApp(repo);
    try {
      const { body } = await get(app, '/api/savings?range=d7');
      assert.ok(body.data.breakdown, 'expected breakdown field');
      assert.equal(body.data.breakdown.cloud.sessions, 2);
      assert.equal(body.data.breakdown.local.sessions, 2, 'rejected local excluded');
      // Local credit = sum of cloudEquivalentDollars for non-rejected local rows.
      assert.ok(Math.abs(body.data.breakdown.local.savedDollars - 0.12) < 1e-9);
      // Cloud "savings" = sum of (baseline - optimized) tokens for cloud rows.
      const cloudSaved = (30000 - 8000) + (22000 - 7000);
      assert.equal(body.data.breakdown.cloud.savedTokens, cloudSaved);
    } finally {
      await app.close();
    }
  });

  it('breakdown is present even with no rows (zeroed)', async () => {
    const repo = { listLaunchBudgetsSince: () => [] };
    const app = await startApp(repo);
    try {
      const { body } = await get(app, '/api/savings?range=today');
      assert.ok(body.data.breakdown);
      assert.equal(body.data.breakdown.cloud.sessions, 0);
      assert.equal(body.data.breakdown.local.sessions, 0);
      assert.equal(body.data.breakdown.local.savedDollars, 0);
    } finally {
      await app.close();
    }
  });
});
