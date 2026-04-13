import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createMemoryEngine } from '../../src/memory/memory-engine.js';

// ── Shared test setup ─────────────────────────────────────────────────────────

let db;
let tmpDir;
let repo;
let engine;
let projectId;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agent-office-memory-engine-test-'));
  db = openDatabase(join(tmpDir, 'test.db'));
  await runMigrations(db);
  repo = createRepository(db);
  engine = createMemoryEngine(repo);

  // All tests share a single project row.
  projectId = repo.createProject({ path: '/tmp/test-project', name: 'Test Project' });
});

after(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helper ────────────────────────────────────────────────────────────────────

function seedMemory(overrides = {}) {
  return engine.create({
    projectId,
    domain: 'backend',
    type: 'fact',
    content: 'Default content',
    ...overrides,
  });
}

// ── queryForPersona ───────────────────────────────────────────────────────────

describe('queryForPersona', () => {
  it('returns memories matching the primary domain', async () => {
    const id = seedMemory({ domain: 'backend', content: 'primary domain fact' });
    const persona = { domain: 'backend' };
    const results = engine.queryForPersona(projectId, persona);
    assert.ok(results.some((m) => m.id === id), 'primary domain memory not found');
  });

  it('returns memories matching secondary domains', async () => {
    const id = seedMemory({ domain: 'security', content: 'secondary domain fact' });
    const persona = { domain: 'backend', secondaryDomains: ['security'] };
    const results = engine.queryForPersona(projectId, persona);
    assert.ok(results.some((m) => m.id === id), 'secondary domain memory not found');
  });

  it('returns general domain memories regardless of persona domain', async () => {
    const id = seedMemory({ domain: 'general', content: 'general fact' });
    const persona = { domain: 'frontend' };
    const results = engine.queryForPersona(projectId, persona);
    assert.ok(results.some((m) => m.id === id), 'general domain memory not found');
  });

  it('excludes archived memories', async () => {
    const id = seedMemory({ domain: 'backend', content: 'archived fact' });
    engine.archive(id, 'no longer relevant');
    const persona = { domain: 'backend' };
    const results = engine.queryForPersona(projectId, persona);
    assert.ok(!results.some((m) => m.id === id), 'archived memory should be excluded');
  });

  it('excludes memories with unrelated domains', async () => {
    const id = seedMemory({ domain: 'devops', content: 'devops only fact' });
    const persona = { domain: 'frontend', secondaryDomains: ['design'] };
    const results = engine.queryForPersona(projectId, persona);
    assert.ok(!results.some((m) => m.id === id), 'unrelated domain memory should be excluded');
  });
});

// ── create ────────────────────────────────────────────────────────────────────

describe('create', () => {
  it('returns a memoryId and the record is retrievable via repo', async () => {
    const id = engine.create({
      projectId,
      domain: 'backend',
      type: 'decision',
      content: 'Use PostgreSQL',
    });

    assert.equal(typeof id, 'number');
    assert.ok(id > 0);

    const memory = repo.getMemory(id);
    assert.equal(memory.content, 'Use PostgreSQL');
    assert.equal(memory.domain, 'backend');
    assert.equal(memory.type, 'decision');
    assert.equal(memory.projectId, projectId);
  });

  it('throws when projectId is missing', async () => {
    assert.throws(
      () => engine.create({ domain: 'backend', type: 'fact', content: 'x' }),
      /projectId is required/,
    );
  });

  it('throws when domain is missing', async () => {
    assert.throws(
      () => engine.create({ projectId, type: 'fact', content: 'x' }),
      /domain is required/,
    );
  });

  it('throws when type is missing', async () => {
    assert.throws(
      () => engine.create({ projectId, domain: 'backend', content: 'x' }),
      /type is required/,
    );
  });

  it('throws when content is missing', async () => {
    assert.throws(
      () => engine.create({ projectId, domain: 'backend', type: 'fact' }),
      /content is required/,
    );
  });
});

// ── archive ───────────────────────────────────────────────────────────────────

describe('archive', () => {
  it('sets status to archived and records the staleness signal', async () => {
    const id = seedMemory({ content: 'to be archived' });
    engine.archive(id, 'API deprecated');

    const memory = repo.getMemory(id);
    assert.equal(memory.status, 'archived');
    assert.equal(memory.stalenessSignal, 'API deprecated');
  });

  it('works without a staleness signal', async () => {
    const id = seedMemory({ content: 'silent archive' });
    engine.archive(id);

    const memory = repo.getMemory(id);
    assert.equal(memory.status, 'archived');
  });
});

// ── verify ────────────────────────────────────────────────────────────────────

describe('verify', () => {
  it('bumps verification_count and sets last_verified_at', async () => {
    const id = seedMemory({ content: 'needs verification' });

    const before = repo.getMemory(id);
    assert.equal(before.verificationCount, 0);
    assert.equal(before.lastVerifiedAt, null);

    engine.verify(id);

    const after = repo.getMemory(id);
    assert.equal(after.verificationCount, 1);
    assert.ok(after.lastVerifiedAt, 'last_verified_at should be set');
  });

  it('increments count on repeated verification', async () => {
    const id = seedMemory({ content: 'verified twice' });
    engine.verify(id);
    engine.verify(id);

    const memory = repo.getMemory(id);
    assert.equal(memory.verificationCount, 2);
  });

  it('throws for a non-existent memory id', async () => {
    assert.throws(() => engine.verify(999999), /not found/);
  });
});

// ── getStats ──────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('returns correct counts broken down by status', async () => {
    // Use an isolated project so counts are predictable.
    const isolatedProjectId = repo.createProject({
      path: '/tmp/stats-project',
      name: 'Stats Project',
    });

    const ids = [
      engine.create({ projectId: isolatedProjectId, domain: 'backend', type: 'fact', content: 'a1' }),
      engine.create({ projectId: isolatedProjectId, domain: 'backend', type: 'fact', content: 'a2' }),
      engine.create({ projectId: isolatedProjectId, domain: 'backend', type: 'fact', content: 'a3' }),
    ];

    // Archive one, mark one stale via raw updateMemory.
    engine.archive(ids[0], 'old');
    repo.updateMemory(ids[1], { status: 'stale' });

    const stats = engine.getStats(isolatedProjectId);
    assert.equal(stats.total, 3);
    assert.equal(stats.active, 1);
    assert.equal(stats.stale, 1);
    assert.equal(stats.archived, 1);
  });
});

// ── getProjectMemories ────────────────────────────────────────────────────────

describe('getProjectMemories', () => {
  it('returns memories across all domains and statuses', async () => {
    const isolatedProjectId = repo.createProject({
      path: '/tmp/all-memories-project',
      name: 'All Memories Project',
    });

    const id1 = engine.create({ projectId: isolatedProjectId, domain: 'backend', type: 'fact', content: 'back' });
    const id2 = engine.create({ projectId: isolatedProjectId, domain: 'frontend', type: 'fact', content: 'front' });
    const id3 = engine.create({ projectId: isolatedProjectId, domain: 'general', type: 'fact', content: 'gen' });

    engine.archive(id3, 'test');

    const all = engine.getProjectMemories(isolatedProjectId);
    const allIds = all.map((m) => m.id);

    assert.ok(allIds.includes(id1), 'backend memory missing');
    assert.ok(allIds.includes(id2), 'frontend memory missing');
    assert.ok(allIds.includes(id3), 'archived general memory missing');
    assert.equal(all.length, 3);
  });
});
