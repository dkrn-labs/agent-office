import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';

let dbDir, db, repo;

beforeEach(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-acc-'));
  db = openDatabase(path.join(dbDir, 'test.db'));
  await runMigrations(db);
  repo = createRepository(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

function seed(taskHash, outcome, ageHours = 0) {
  const epoch = Math.floor(Date.now() / 1000) - ageHours * 3600;
  return repo.recordFrontdeskDecision({
    taskHash,
    rulesApplied: ['R8'],
    llmInput: { task: `task for ${taskHash}` },
    llmOutput: { persona: 'Backend', provider: 'claude-code', reasoning: 'r' },
    outcome,
    createdAtEpoch: epoch,
  });
}

describe('repo.listRecentAcceptedDecisions', () => {
  it('returns empty array when no decisions exist', () => {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    assert.deepEqual(repo.listRecentAcceptedDecisions({ sinceEpoch: sevenDaysAgo }), []);
  });

  it('returns only accepted + partial within window, ordered DESC by epoch', () => {
    seed('a', 'accepted', 1);
    seed('b', 'rejected', 2);   // anti-signal — excluded
    seed('c', 'partial', 3);
    seed('d', 'accepted', 4);
    seed('e', null, 5);          // unset — excluded
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const out = repo.listRecentAcceptedDecisions({ sinceEpoch: sevenDaysAgo, limit: 10 });
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((r) => r.taskHash), ['a', 'c', 'd']);
  });

  it('honors the time window — older rows are dropped', () => {
    seed('recent', 'accepted', 1);
    seed('ancient', 'accepted', 30 * 24); // 30 days old
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const out = repo.listRecentAcceptedDecisions({ sinceEpoch: sevenDaysAgo });
    assert.equal(out.length, 1);
    assert.equal(out[0].taskHash, 'recent');
  });

  it('honors the limit', () => {
    for (const x of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) seed(x, 'accepted', 1);
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const out = repo.listRecentAcceptedDecisions({ sinceEpoch: sevenDaysAgo, limit: 3 });
    assert.equal(out.length, 3);
  });

  it('rejects non-numeric sinceEpoch', () => {
    assert.throws(() => repo.listRecentAcceptedDecisions({ sinceEpoch: 'yesterday' }), /sinceEpoch must be a number/);
  });
});
