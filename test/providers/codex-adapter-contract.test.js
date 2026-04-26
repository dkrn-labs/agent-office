import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

import codexAdapter from '../../src/providers/codex.js';

function makeStateDb(rows) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-state-'));
  const dbPath = path.join(tmp, 'state_5.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      model TEXT,
      tokens_used INTEGER,
      updated_at INTEGER
    );
  `);
  const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?)');
  for (const r of rows) insert.run(r.id, r.cwd, r.model, r.tokens_used, r.updated_at);
  db.close();
  return dbPath;
}

describe('codex adapter — contract surface', () => {
  it('exposes installHook, parseTranscript, telemetry.sample, quota', () => {
    assert.equal(typeof codexAdapter.installHook, 'function');
    assert.equal(typeof codexAdapter.parseTranscript, 'function');
    assert.equal(typeof codexAdapter.telemetry?.sample, 'function');
    assert.equal(typeof codexAdapter.quota, 'function');
  });

  it('parseTranscript reads recent threads from state_5.sqlite', () => {
    const dbPath = makeStateDb([
      { id: 't1', cwd: '/p/a', model: 'gpt-5.4', tokens_used: 1200, updated_at: 1000 },
      { id: 't2', cwd: '/p/b', model: 'gpt-5.4', tokens_used:  500, updated_at: 2000 },
    ]);
    const events = codexAdapter.parseTranscript(dbPath);
    assert.ok(Array.isArray(events));
    assert.equal(events.length, 2);
    assert.equal(events[0].providerSessionId, 't2'); // most-recent first
    assert.equal(events[0].totals.total, 500);
    assert.equal(events[0].lastModel, 'gpt-5.4');
    assert.match(events[0].lastActivity, /1970-01-01T00:33:20/); // 2000 epoch sec
  });

  it('parseTranscript returns [] for missing file (no throw)', () => {
    const events = codexAdapter.parseTranscript('/nonexistent/state.sqlite');
    assert.deepEqual(events, []);
  });

  it('telemetry.sample reads the launch_budget row via injected repo', () => {
    const fakeRepo = {
      getLaunchBudgetForSession(id) {
        assert.equal(id, 42);
        return { tokensInOptimized: 600, tokensOutOptimized: 80, costDollars: 0.012 };
      },
    };
    const out = codexAdapter.telemetry.sample(42, { repo: fakeRepo });
    assert.deepEqual(out, { inputTokens: 600, outputTokens: 80, costDollars: 0.012 });
  });

  it('telemetry.sample returns null when budget row missing', () => {
    const fakeRepo = { getLaunchBudgetForSession: () => null };
    assert.equal(codexAdapter.telemetry.sample(99, { repo: fakeRepo }), null);
  });

  it('quota returns null until abtop bridge ships in P4', async () => {
    assert.equal(await codexAdapter.quota(), null);
  });

  it('installHook is idempotent — second call reports changed=false', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[history]\nmax = 100\n');

    const r1 = await codexAdapter.installHook({ home, hookScript: '/tmp/hook.js' });
    assert.equal(r1.changed, true);
    const r2 = await codexAdapter.installHook({ home, hookScript: '/tmp/hook.js' });
    assert.equal(r2.changed, false);
    assert.match(r2.reason, /already installed/);
  });
});
