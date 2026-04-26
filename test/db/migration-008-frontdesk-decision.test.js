import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ao-mig008-'));
  const db = openDatabase(join(dir, 'test.db'));
  return { dir, db };
}

function cleanup({ dir, db }) {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

describe('migration 008 — frontdesk_decision', () => {
  it('creates the table with the expected columns', async () => {
    const ctx = setup();
    try {
      await runMigrations(ctx.db);
      const cols = ctx.db.prepare(`PRAGMA table_info(frontdesk_decision)`).all();
      const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

      assert.ok(byName.id, 'id column exists');
      assert.equal(byName.id.pk, 1);
      assert.ok(byName.task_hash);
      assert.equal(byName.task_hash.notnull, 1);
      assert.ok(byName.rules_applied);
      assert.ok(byName.llm_input);
      assert.ok(byName.llm_output);
      assert.ok(byName.user_accepted);
      assert.ok(byName.outcome);
      assert.ok(byName.created_at_epoch);
      assert.equal(byName.created_at_epoch.notnull, 1);
    } finally {
      cleanup(ctx);
    }
  });

  it('accepts an insert and round-trips JSON columns as text', async () => {
    const ctx = setup();
    try {
      await runMigrations(ctx.db);
      const now = Date.now();
      ctx.db.prepare(`
        INSERT INTO frontdesk_decision
          (task_hash, rules_applied, llm_input, llm_output, user_accepted, outcome, created_at_epoch)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'hash-abc',
        JSON.stringify(['R1', 'R8']),
        JSON.stringify({ task: 'fix bug' }),
        JSON.stringify({ persona: 'debug', provider: 'claude-code' }),
        null,
        null,
        now,
      );

      const row = ctx.db.prepare(`SELECT * FROM frontdesk_decision`).get();
      assert.equal(row.task_hash, 'hash-abc');
      assert.deepEqual(JSON.parse(row.rules_applied), ['R1', 'R8']);
      assert.deepEqual(JSON.parse(row.llm_output), { persona: 'debug', provider: 'claude-code' });
      assert.equal(row.user_accepted, null);
      assert.equal(row.outcome, null);
      assert.equal(row.created_at_epoch, now);
    } finally {
      cleanup(ctx);
    }
  });

  it('indexes created_at_epoch for the few-shot sampler', async () => {
    const ctx = setup();
    try {
      await runMigrations(ctx.db);
      const idx = ctx.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='frontdesk_decision'
      `).all();
      const names = idx.map((r) => r.name);
      assert.ok(
        names.some((n) => n.includes('created_at')),
        `expected an index on created_at_epoch, got: ${names.join(', ')}`,
      );
    } finally {
      cleanup(ctx);
    }
  });
});
