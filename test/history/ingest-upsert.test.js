import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createProjectHistoryStore } from '../../src/history/project-history.js';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-ingest-'));
  const dbPath = join(dir, 'test.db');
  const db = openDatabase(dbPath);
  await runMigrations(db);
  const repo = createRepository(db);
  const store = createProjectHistoryStore(repo, { db, brief: { enabled: false } });
  const projectId = Number(repo.createProject({ path: '/tmp/p', name: 'p', techStack: [] }));
  const personaId = Number(repo.createPersona({ label: 'Eng', domain: 'software' }));
  return { dir, db, repo, store, projectId, personaId };
}

function cleanup({ dir, db }) {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

describe('historyStore.ingest upsert by historySessionId', () => {
  it('merges observations into the pre-created history_session row', async () => {
    const ctx = await setup();
    const { repo, store, projectId, personaId } = ctx;
    try {
      const preId = repo.createHistorySession({
        projectId,
        personaId,
        providerId: 'claude-code',
        providerSessionId: null,
        status: 'in-progress',
        source: 'launcher',
      });

      const result = store.ingest({
        projectId,
        historySessionId: preId,
        providerId: 'claude-code',
        providerSessionId: 'claude-abc',
        status: 'completed',
        source: 'provider-hook',
        summary: { summaryKind: 'turn', completed: 'done', createdAt: new Date().toISOString() },
        observations: [
          {
            type: 'change',
            title: 'edit',
            narrative: 'edited file',
            createdAt: new Date().toISOString(),
          },
        ],
      });

      assert.equal(result.historySession.id, preId);
      const row = repo.getHistorySession(preId);
      assert.equal(row.personaId, personaId);
      assert.equal(row.providerSessionId, 'claude-abc');
      assert.equal(row.status, 'completed');
      assert.equal(row.source, 'launcher');
      const obs = repo.listHistoryObservations({ projectId, limit: 10 });
      assert.equal(obs.length, 1);
      assert.equal(obs[0].historySessionId, preId);
    } finally {
      cleanup(ctx);
    }
  });

  it('falls back to provider-session lookup when no historySessionId is given', async () => {
    const ctx = await setup();
    const { store, projectId } = ctx;
    try {
      const first = store.ingest({
        projectId,
        providerId: 'claude-code',
        providerSessionId: 'claude-xyz',
        summary: { summaryKind: 'turn', completed: 'one', createdAt: new Date().toISOString() },
        observations: [],
      });
      const second = store.ingest({
        projectId,
        providerId: 'claude-code',
        providerSessionId: 'claude-xyz',
        summary: { summaryKind: 'turn', completed: 'two', createdAt: new Date().toISOString() },
        observations: [],
      });
      assert.equal(first.historySession.id, second.historySession.id);
    } finally {
      cleanup(ctx);
    }
  });

  it('throws when historySessionId belongs to a different project', async () => {
    const ctx = await setup();
    const { repo, store, personaId } = ctx;
    try {
      const otherProjectId = Number(repo.createProject({ path: '/tmp/q', name: 'q', techStack: [] }));
      const otherHistoryId = repo.createHistorySession({
        projectId: otherProjectId,
        personaId,
        providerId: 'claude-code',
        providerSessionId: null,
        status: 'in-progress',
        source: 'launcher',
      });
      const primaryProjectId = Number(repo.createProject({ path: '/tmp/r', name: 'r', techStack: [] }));
      assert.throws(
        () =>
          store.ingest({
            projectId: primaryProjectId,
            historySessionId: otherHistoryId,
            providerId: 'claude-code',
            providerSessionId: 'x',
            summary: { summaryKind: 'turn', completed: 'x', createdAt: new Date().toISOString() },
            observations: [],
          }),
        /historySessionId belongs to a different project/,
      );
    } finally {
      cleanup(ctx);
    }
  });
});
