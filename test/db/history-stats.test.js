import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-hist-stats-'));
  const db = openDatabase(join(dir, 'test.db'));
  await runMigrations(db);
  const repo = createRepository(db);
  const projectId = Number(repo.createProject({ path: '/tmp/ps', name: 'ps' }));
  const personaId = Number(repo.createPersona({ label: 'Eng', domain: 'software' }));
  return { dir, db, repo, projectId, personaId };
}

function cleanup({ dir, db }) {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

function addSession(repo, { projectId, personaId, startedAt, endedAt, metrics }) {
  const id = Number(
    repo.createHistorySession({
      projectId,
      personaId,
      providerId: 'claude-code',
      providerSessionId: `s-${startedAt}`,
      startedAt,
      endedAt,
      status: endedAt ? 'completed' : 'in-progress',
      source: 'launcher',
    }),
  );
  if (metrics) repo.upsertHistorySessionMetrics(id, metrics);
  return id;
}

describe('history_session stat helpers', () => {
  it('counts history_sessions started since a cutoff', async () => {
    const ctx = await setup();
    try {
      addSession(ctx.repo, { ...ctx, startedAt: '2026-04-18T10:00:00.000Z' });
      addSession(ctx.repo, { ...ctx, startedAt: '2026-04-19T10:00:00.000Z' });
      addSession(ctx.repo, { ...ctx, startedAt: '2026-04-19T11:00:00.000Z' });
      assert.equal(ctx.repo.countHistorySessionsSince('2026-04-19T00:00:00.000Z'), 2);
      assert.equal(ctx.repo.countHistorySessionsSince('2099-01-01T00:00:00.000Z'), 0);
    } finally {
      cleanup(ctx);
    }
  });

  it('sums tokens from metrics for sessions started since cutoff', async () => {
    const ctx = await setup();
    try {
      addSession(ctx.repo, {
        ...ctx,
        startedAt: '2026-04-19T09:00:00.000Z',
        metrics: { tokensIn: 10, tokensOut: 20, tokensCacheRead: 30, tokensCacheWrite: 40 },
      });
      addSession(ctx.repo, {
        ...ctx,
        startedAt: '2026-04-19T10:00:00.000Z',
        metrics: { tokensIn: 1, tokensOut: 2, tokensCacheRead: 3, tokensCacheWrite: 4 },
      });
      assert.equal(ctx.repo.sumHistoryTokensSince('2026-04-19T00:00:00.000Z'), 110);
    } finally {
      cleanup(ctx);
    }
  });

  it('sums commits_produced from metrics for sessions ended since cutoff', async () => {
    const ctx = await setup();
    try {
      addSession(ctx.repo, {
        ...ctx,
        startedAt: '2026-04-19T09:00:00.000Z',
        endedAt: '2026-04-19T09:30:00.000Z',
        metrics: { commitsProduced: 3 },
      });
      // Session ended before cutoff — excluded.
      addSession(ctx.repo, {
        ...ctx,
        startedAt: '2026-04-18T09:00:00.000Z',
        endedAt: '2026-04-18T09:30:00.000Z',
        metrics: { commitsProduced: 99 },
      });
      assert.equal(ctx.repo.sumHistoryCommitsSince('2026-04-19T00:00:00.000Z'), 3);
    } finally {
      cleanup(ctx);
    }
  });

  it('returns hour-bucketed tokens for pulse chart', async () => {
    const ctx = await setup();
    try {
      addSession(ctx.repo, {
        ...ctx,
        startedAt: '2026-04-19T09:15:00.000Z',
        endedAt: '2026-04-19T09:45:00.000Z',
        metrics: { tokensIn: 50, tokensOut: 50 },
      });
      addSession(ctx.repo, {
        ...ctx,
        startedAt: '2026-04-19T10:15:00.000Z',
        metrics: { tokensIn: 5, tokensOut: 5 },
      });
      const buckets = ctx.repo.getHistoryPulseBucketsSince('2026-04-19T00:00:00.000Z');
      const map = new Map(buckets.map((b) => [b.hourStart, b.tokens]));
      assert.equal(map.get('2026-04-19T09:00:00.000Z'), 100);
      assert.equal(map.get('2026-04-19T10:00:00.000Z'), 10);
    } finally {
      cleanup(ctx);
    }
  });

  it('returns 0 for empty ranges', async () => {
    const ctx = await setup();
    try {
      assert.equal(ctx.repo.countHistorySessionsSince('2099-01-01T00:00:00.000Z'), 0);
      assert.equal(ctx.repo.sumHistoryTokensSince('2099-01-01T00:00:00.000Z'), 0);
      assert.equal(ctx.repo.sumHistoryCommitsSince('2099-01-01T00:00:00.000Z'), 0);
      assert.deepEqual(ctx.repo.getHistoryPulseBucketsSince('2099-01-01T00:00:00.000Z'), []);
    } finally {
      cleanup(ctx);
    }
  });
});
