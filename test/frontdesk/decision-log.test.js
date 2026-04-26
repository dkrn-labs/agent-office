import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createDecisionLog, hashTask } from '../../src/frontdesk/decision-log.js';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ao-decision-log-'));
  const db = openDatabase(join(dir, 'test.db'));
  await runMigrations(db);
  const repo = createRepository(db);
  return { dir, db, repo, log: createDecisionLog({ repo }) };
}

function cleanup({ dir, db }) {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

describe('frontdesk decision-log', () => {
  it('hashTask is stable for equal inputs and different for distinct inputs', () => {
    assert.equal(hashTask('fix the bug'), hashTask('fix the bug'));
    assert.notEqual(hashTask('fix the bug'), hashTask('add the feature'));
    assert.equal(hashTask('fix the bug').length, 64); // sha256 hex
  });

  it('round-trips a decision via record() and listFrontdeskDecisions()', async () => {
    const ctx = await setup();
    try {
      const { log, repo } = ctx;
      const id = log.record({
        task: 'refactor history store',
        rulesApplied: ['R1', 'R8'],
        llmInput: { task: 'refactor history store', candidates: { personas: ['arch'] } },
        llmOutput: { persona: 'arch', provider: 'claude-code', model: 'claude-opus-4-7', reasoning: 'big task' },
      });
      assert.equal(typeof id, 'number');

      const rows = repo.listFrontdeskDecisions({ limit: 5 });
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(row.id, id);
      assert.equal(row.taskHash, hashTask('refactor history store'));
      assert.deepEqual(row.rulesApplied, ['R1', 'R8']);
      assert.equal(row.llmOutput.persona, 'arch');
      assert.equal(row.userAccepted, null);
      assert.equal(row.outcome, null);
      assert.equal(typeof row.createdAtEpoch, 'number');
    } finally {
      cleanup(ctx);
    }
  });

  it('listFrontdeskDecisions filters by outcome and respects limit', async () => {
    const ctx = await setup();
    try {
      const { log, repo } = ctx;
      log.record({ task: 't1', rulesApplied: [], llmInput: {}, llmOutput: { ok: 1 } });
      const id2 = log.record({ task: 't2', rulesApplied: [], llmInput: {}, llmOutput: { ok: 2 } });
      log.record({ task: 't3', rulesApplied: [], llmInput: {}, llmOutput: { ok: 3 } });

      // Patch outcome on id2 directly via repo to avoid coupling to a setter we
      // haven't written yet.
      ctx.db.prepare(`UPDATE frontdesk_decision SET outcome = 'accepted' WHERE id = ?`).run(id2);

      const accepted = repo.listFrontdeskDecisions({ limit: 10, outcome: 'accepted' });
      assert.equal(accepted.length, 1);
      assert.equal(accepted[0].id, id2);

      const limited = repo.listFrontdeskDecisions({ limit: 2 });
      assert.equal(limited.length, 2);
    } finally {
      cleanup(ctx);
    }
  });
});
