import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';

// Helper: create a fresh tmp dir + db for each test that needs isolation.
function makeTmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-test-'));
  const dbPath = join(dir, 'test.db');
  const db = openDatabase(dbPath);
  return { db, dir };
}

// ── Shared db for most tests ─────────────────────────────────────────────────
let sharedDb;
let sharedDir;

before(async () => {
  sharedDir = mkdtempSync(join(tmpdir(), 'agent-office-test-'));
  sharedDb = openDatabase(join(sharedDir, 'main.db'));
  await runMigrations(sharedDb);
});

after(() => {
  sharedDb.close();
  rmSync(sharedDir, { recursive: true, force: true });
});

// ── WAL mode ─────────────────────────────────────────────────────────────────
describe('openDatabase', () => {
  it('enables WAL journal mode', () => {
    const { db, dir } = makeTmpDb();
    try {
      const row = db.pragma('journal_mode', { simple: true });
      assert.equal(row, 'wal');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces foreign keys', () => {
    const { db, dir } = makeTmpDb();
    try {
      const row = db.pragma('foreign_keys', { simple: true });
      assert.equal(row, 1);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates parent directory if it does not exist', () => {
    const base = mkdtempSync(join(tmpdir(), 'agent-office-test-'));
    const nested = join(base, 'deep', 'nested', 'test.db');
    let db;
    try {
      db = openDatabase(nested);
      // If we got here without throwing, the directory was created.
      assert.ok(db.open);
    } finally {
      db?.close();
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// ── V1 tables ─────────────────────────────────────────────────────────────────
describe('runMigrations — v1 tables', () => {
  const v1Tables = [
    'project',
    'persona',
    'session',
    'memory',
    'skill',
    'garden_log',
    'garden_rule',
  ];

  for (const table of v1Tables) {
    it(`creates table: ${table}`, () => {
      const row = sharedDb
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table);
      assert.ok(row, `table '${table}' should exist`);
    });
  }
});

// ── Future placeholder tables ─────────────────────────────────────────────────
describe('runMigrations — future placeholder tables', () => {
  const futureTables = ['provider', 'workflow', 'user', 'skill_session'];

  for (const table of futureTables) {
    it(`creates future table: ${table}`, () => {
      const row = sharedDb
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table);
      assert.ok(row, `future table '${table}' should exist`);
    });
  }
});

// ── Migration tracking ────────────────────────────────────────────────────────
describe('runMigrations — tracking', () => {
  it('records migration version 1 in _migrations', () => {
    const row = sharedDb.prepare('SELECT version FROM _migrations WHERE version=1').get();
    assert.ok(row, '_migrations should contain version 1');
    assert.equal(row.version, 1);
  });

  it('is idempotent — running migrations again does not duplicate rows', async () => {
    await runMigrations(sharedDb);
    const rows = sharedDb.prepare('SELECT version FROM _migrations').all();
    const versions = rows.map((r) => r.version);
    const unique = [...new Set(versions)];
    assert.deepEqual(versions.sort(), unique.sort());
  });
});

// ── Insert / read round-trip ──────────────────────────────────────────────────
describe('project table — basic CRUD', () => {
  it('inserts and reads a project row', () => {
    sharedDb.prepare(`
      INSERT INTO project (path, name, tech_stack, active)
      VALUES (?, ?, ?, 1)
    `).run('/Users/test/my-project', 'my-project', JSON.stringify(['node', 'react']));

    const row = sharedDb
      .prepare(`SELECT * FROM project WHERE path=?`)
      .get('/Users/test/my-project');

    assert.ok(row);
    assert.equal(row.name, 'my-project');
    assert.deepEqual(JSON.parse(row.tech_stack), ['node', 'react']);
    assert.equal(row.active, 1);
  });

  it('enforces UNIQUE constraint on path', () => {
    sharedDb.prepare(`
      INSERT INTO project (path, name) VALUES (?, ?)
    `).run('/unique/path', 'first');

    assert.throws(
      () =>
        sharedDb.prepare(`
          INSERT INTO project (path, name) VALUES (?, ?)
        `).run('/unique/path', 'duplicate'),
      /UNIQUE constraint failed/,
    );
  });
});

// ── Foreign key enforcement ───────────────────────────────────────────────────
describe('session table — foreign key enforcement', () => {
  it('rejects a session referencing a non-existent project_id', () => {
    assert.throws(
      () =>
        sharedDb.prepare(`
          INSERT INTO session (project_id, persona_id, provider_id)
          VALUES (999999, 999999, 'claude-code')
        `).run(),
      /FOREIGN KEY constraint failed/,
    );
  });
});

// ── Default values ────────────────────────────────────────────────────────────
describe('session table — default column values', () => {
  it('applies default values for token/commit columns', () => {
    // Need valid FK references first.
    const projectId = sharedDb.prepare(`
      INSERT INTO project (path, name) VALUES (?, ?)
    `).run('/defaults-test/project', 'defaults-project').lastInsertRowid;

    const personaId = sharedDb.prepare(`
      INSERT INTO persona (label, domain) VALUES (?, ?)
    `).run('Tester', 'testing').lastInsertRowid;

    const sessionId = sharedDb.prepare(`
      INSERT INTO session (project_id, persona_id) VALUES (?, ?)
    `).run(projectId, personaId).lastInsertRowid;

    const row = sharedDb.prepare('SELECT * FROM session WHERE session_id=?').get(sessionId);
    assert.equal(row.tokens_in, 0);
    assert.equal(row.tokens_out, 0);
    assert.equal(row.tokens_cache_read, 0);
    assert.equal(row.tokens_cache_write, 0);
    assert.equal(row.commits_produced, 0);
    assert.equal(row.diff_exists, 0);
    assert.equal(row.outcome, 'unknown');
    assert.equal(row.provider_id, 'claude-code');
  });
});
