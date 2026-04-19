import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createProjectHistoryStore } from '../../src/history/project-history.js';

/**
 * Creates a self-contained async test context with a fully-migrated SQLite db,
 * repository, and project history store.
 *
 * Usage:
 *   const ctx = await createTestContext();
 *   t.after(() => ctx.cleanup());
 *   const { repo, projectHistory } = ctx;
 */
export async function createTestContext() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-test-'));
  const dbPath = join(dir, 'test.db');
  const db = openDatabase(dbPath);
  await runMigrations(db);

  const repo = createRepository(db);
  const projectHistory = createProjectHistoryStore(repo, { db, brief: { enabled: false } });

  function cleanup() {
    try { db.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }

  return { db, repo, projectHistory, cleanup };
}
