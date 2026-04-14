import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClaudeMemAdapter } from '../../src/memory/claude-mem-adapter.js';

let dir;
let dbPath;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'claude-mem-adapter-test-'));
  dbPath = join(dir, 'claude-mem.db');
  // Build minimal schema matching ~/.claude-mem/claude-mem.db
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sdk_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_session_id TEXT UNIQUE NOT NULL,
      memory_session_id TEXT UNIQUE,
      project TEXT NOT NULL,
      started_at TEXT NOT NULL,
      started_at_epoch INTEGER NOT NULL,
      custom_title TEXT
    );
    CREATE TABLE session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      completed TEXT,
      next_steps TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      title TEXT,
      subtitle TEXT,
      narrative TEXT,
      type TEXT NOT NULL,
      files_modified TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );
  `);
  // Seed rows
  db.prepare(`INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, custom_title)
              VALUES ('c1', 'm1', 'dk-cc', '2026-04-13', 1776000000000, 'Phase 4.5 complete')`).run();
  db.prepare(`INSERT INTO session_summaries (memory_session_id, project, completed, next_steps, created_at, created_at_epoch)
              VALUES ('m1', 'dk-cc', 'Shipped pixel-art office', 'Telemetry phase', '2026-04-13', 1776000000000)`).run();
  db.prepare(`INSERT INTO observations (memory_session_id, project, title, subtitle, narrative, type, files_modified, created_at, created_at_epoch)
              VALUES ('m1', 'dk-cc', 'Fixed seat mapping', 'preferredSeatId passed', 'Details...', 'bugfix', '["ui/src/office/OfficeCanvas.jsx"]', '2026-04-13', 1776000000000)`).run();
  db.prepare(`INSERT INTO observations (memory_session_id, project, title, subtitle, narrative, type, files_modified, created_at, created_at_epoch)
              VALUES ('m1', 'dk-cc', 'Backend route', NULL, 'Details...', 'feature', '["src/api/routes/office.js"]', '2026-04-13', 1776000001000)`).run();
  db.close();
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createClaudeMemAdapter', () => {
  it('returns null when db file does not exist', () => {
    const adapter = createClaudeMemAdapter('/nonexistent/path.db');
    assert.equal(adapter, null);
  });

  it('returns adapter object when db exists', () => {
    const adapter = createClaudeMemAdapter(dbPath);
    assert.ok(adapter);
    assert.equal(typeof adapter.getLastSession, 'function');
    assert.equal(typeof adapter.getObservations, 'function');
    assert.equal(typeof adapter.close, 'function');
    adapter.close();
  });
});

describe('adapter.getLastSession()', () => {
  it('returns the most recent session for a project', () => {
    const adapter = createClaudeMemAdapter(dbPath);
    const last = adapter.getLastSession('dk-cc');
    assert.ok(last);
    assert.equal(last.title, 'Phase 4.5 complete');
    assert.equal(last.completed, 'Shipped pixel-art office');
    assert.equal(last.nextSteps, 'Telemetry phase');
    adapter.close();
  });

  it('returns null for unknown project', () => {
    const adapter = createClaudeMemAdapter(dbPath);
    assert.equal(adapter.getLastSession('nonexistent'), null);
    adapter.close();
  });
});

describe('adapter.getObservations()', () => {
  it('returns observations sorted by recency', () => {
    const adapter = createClaudeMemAdapter(dbPath);
    const obs = adapter.getObservations('dk-cc');
    assert.equal(obs.length, 2);
    assert.equal(obs[0].title, 'Backend route');
    assert.equal(obs[1].title, 'Fixed seat mapping');
    adapter.close();
  });

  it('parses files_modified JSON', () => {
    const adapter = createClaudeMemAdapter(dbPath);
    const obs = adapter.getObservations('dk-cc');
    assert.deepEqual(obs[0].filesModified, ['src/api/routes/office.js']);
    assert.deepEqual(obs[1].filesModified, ['ui/src/office/OfficeCanvas.jsx']);
    adapter.close();
  });

  it('respects limit option', () => {
    const adapter = createClaudeMemAdapter(dbPath);
    const obs = adapter.getObservations('dk-cc', { limit: 1 });
    assert.equal(obs.length, 1);
    adapter.close();
  });
});
