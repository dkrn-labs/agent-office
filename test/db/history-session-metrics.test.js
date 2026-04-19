import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-metrics-'));
  const db = openDatabase(join(dir, 'test.db'));
  await runMigrations(db);
  const repo = createRepository(db);
  const projectId = Number(repo.createProject({ path: '/tmp/pm', name: 'pm' }));
  const personaId = Number(repo.createPersona({ label: 'Eng', domain: 'software' }));
  const historySessionId = Number(
    repo.createHistorySession({
      projectId,
      personaId,
      providerId: 'claude-code',
      providerSessionId: 'claude-xyz',
      status: 'in-progress',
      source: 'launcher',
    }),
  );
  return { dir, db, repo, projectId, personaId, historySessionId };
}

function cleanup({ dir, db }) {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

describe('history_session_metrics', () => {
  it('upserts metrics and reads them back', async () => {
    const ctx = await setup();
    try {
      ctx.repo.upsertHistorySessionMetrics(ctx.historySessionId, {
        tokensIn: 100,
        tokensOut: 200,
        costUsd: 0.05,
        lastModel: 'claude-opus-4-7',
      });
      const row = ctx.repo.getHistorySessionMetrics(ctx.historySessionId);
      assert.equal(row.tokensIn, 100);
      assert.equal(row.tokensOut, 200);
      assert.equal(row.costUsd, 0.05);
      assert.equal(row.lastModel, 'claude-opus-4-7');
    } finally {
      cleanup(ctx);
    }
  });

  it('partial upsert preserves prior fields via COALESCE', async () => {
    const ctx = await setup();
    try {
      ctx.repo.upsertHistorySessionMetrics(ctx.historySessionId, {
        tokensIn: 100,
        tokensOut: 200,
        costUsd: 0.05,
      });
      // Second call only updates outcome — previous tokens/cost must survive.
      ctx.repo.upsertHistorySessionMetrics(ctx.historySessionId, {
        outcome: 'accepted',
        diffExists: true,
      });
      const row = ctx.repo.getHistorySessionMetrics(ctx.historySessionId);
      assert.equal(row.tokensIn, 100);
      assert.equal(row.tokensOut, 200);
      assert.equal(row.costUsd, 0.05);
      assert.equal(row.outcome, 'accepted');
      assert.equal(row.diffExists, true);
    } finally {
      cleanup(ctx);
    }
  });

  it('findHistorySessionIdByProvider resolves via (providerId, providerSessionId)', async () => {
    const ctx = await setup();
    try {
      const id = ctx.repo.findHistorySessionIdByProvider('claude-code', 'claude-xyz');
      assert.equal(id, ctx.historySessionId);
      assert.equal(ctx.repo.findHistorySessionIdByProvider('claude-code', 'missing'), null);
      assert.equal(ctx.repo.findHistorySessionIdByProvider(null, 'x'), null);
    } finally {
      cleanup(ctx);
    }
  });

  it('cascades delete when history_session is deleted', async () => {
    const ctx = await setup();
    try {
      ctx.repo.upsertHistorySessionMetrics(ctx.historySessionId, { tokensIn: 5 });
      ctx.db.prepare('DELETE FROM history_session WHERE history_session_id = ?').run(
        ctx.historySessionId,
      );
      assert.equal(ctx.repo.getHistorySessionMetrics(ctx.historySessionId), null);
    } finally {
      cleanup(ctx);
    }
  });

  it('migration 006 backfills metrics from paired legacy session rows', async () => {
    const ctx = await setup();
    try {
      // Create a paired legacy session row with telemetry populated.
      const legacySessionId = Number(
        ctx.repo.createSession({
          projectId: ctx.projectId,
          personaId: ctx.personaId,
          providerId: 'claude-code',
          startedAt: new Date().toISOString(),
        }),
      );
      ctx.repo.updateSession(legacySessionId, {
        providerSessionId: 'claude-xyz',
        tokensIn: 42,
        tokensOut: 84,
        costUsd: 0.01,
      });
      // Re-run migration 006 logic by deleting the metrics row and re-executing the backfill.
      ctx.db.prepare('DELETE FROM history_session_metrics').run();
      ctx.db.exec(`
        INSERT OR IGNORE INTO history_session_metrics (
          history_session_id, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write,
          cost_usd, commits_produced, diff_exists, outcome, error, last_model, recorded_at
        )
        SELECT
          hs.history_session_id,
          COALESCE(s.tokens_in, 0), COALESCE(s.tokens_out, 0),
          COALESCE(s.tokens_cache_read, 0), COALESCE(s.tokens_cache_write, 0),
          s.cost_usd, COALESCE(s.commits_produced, 0), s.diff_exists, s.outcome, s.error,
          s.last_model, COALESCE(s.ended_at, s.started_at, hs.updated_at, hs.created_at)
        FROM history_session hs
        JOIN session s
          ON s.provider_id = hs.provider_id
         AND s.provider_session_id = hs.provider_session_id
        WHERE hs.provider_session_id IS NOT NULL;
      `);
      const row = ctx.repo.getHistorySessionMetrics(ctx.historySessionId);
      assert.equal(row.tokensIn, 42);
      assert.equal(row.tokensOut, 84);
      assert.equal(row.costUsd, 0.01);
    } finally {
      cleanup(ctx);
    }
  });
});
