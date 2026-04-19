import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createProjectHistoryStore } from '../../src/history/project-history.js';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-createlaunch-'));
  const dbPath = join(dir, 'test.db');
  const db = openDatabase(dbPath);
  await runMigrations(db);
  const repo = createRepository(db);
  const store = createProjectHistoryStore(repo, { db, brief: { enabled: false } });
  const projectId = Number(repo.createProject({ path: '/tmp/p2', name: 'p2', techStack: [] }));
  const personaId = Number(repo.createPersona({ label: 'Eng', domain: 'software' }));
  return { dir, db, repo, store, projectId, personaId };
}

function cleanup({ dir, db }) {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

describe('historyStore.createLaunch', () => {
  it('creates a history_session tagged source=launcher with persona', async () => {
    const ctx = await setup();
    try {
      const { historySessionId } = ctx.store.createLaunch({
        projectId: ctx.projectId,
        personaId: ctx.personaId,
        providerId: 'claude-code',
        startedAt: new Date().toISOString(),
        model: 'claude-opus-4-7',
        systemPrompt: 'system',
      });

      assert.equal(typeof historySessionId, 'number');
      const row = ctx.repo.getHistorySession(historySessionId);
      assert.equal(row.projectId, ctx.projectId);
      assert.equal(row.personaId, ctx.personaId);
      assert.equal(row.providerId, 'claude-code');
      assert.equal(row.source, 'launcher');
      assert.equal(row.status, 'in-progress');
      assert.equal(row.model, 'claude-opus-4-7');
    } finally {
      cleanup(ctx);
    }
  });

  it('returns { historySessionId: null } and does not throw on failure', async () => {
    const ctx = await setup();
    try {
      const result = ctx.store.createLaunch({
        projectId: 999999,
        personaId: ctx.personaId,
        providerId: 'claude-code',
        startedAt: new Date().toISOString(),
      });
      assert.equal(result.historySessionId, null);
    } finally {
      cleanup(ctx);
    }
  });
});
