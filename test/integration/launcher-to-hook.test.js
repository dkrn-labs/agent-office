import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createProjectHistoryStore } from '../../src/history/project-history.js';
import { buildHistoryIngestPayload } from '../../src/history/hook-bridge.js';

describe('Unified history Phase 1: launcher → hook round trip', () => {
  it('hook upserts observations into the launcher-created row (no duplicate)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-roundtrip-'));
    const dbPath = join(dir, 'test.db');
    const db = openDatabase(dbPath);
    await runMigrations(db);
    const repo = createRepository(db);
    const store = createProjectHistoryStore(repo, { db, brief: { enabled: false } });

    try {
      const projectId = Number(
        repo.createProject({ path: dir, name: 'roundtrip', techStack: [] }),
      );
      const personaId = Number(repo.createPersona({ label: 'Eng', domain: 'software' }));

      // 1. Launcher step — pre-create a history_session with source='launcher'
      const preId = repo.createHistorySession({
        projectId,
        personaId,
        providerId: 'claude-code',
        providerSessionId: null,
        status: 'in-progress',
        source: 'launcher',
        startedAt: new Date().toISOString(),
        model: 'claude-sonnet-4-6',
        systemPrompt: 'You are Eng.',
      });

      // 2. Hook step — write a minimal Claude transcript and build payload
      const transcriptPath = join(dir, 't.jsonl');
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'all done' }] },
        })}\n`,
        'utf8',
      );

      const payload = buildHistoryIngestPayload(
        'claude-code',
        {
          session_id: 'claude-session-aaa',
          cwd: dir,
          hook_event_name: 'Stop',
          transcript_path: transcriptPath,
          last_assistant_message: 'all done',
        },
        { historySessionId: preId },
      );

      assert.ok(payload, 'hook built a payload');
      assert.equal(payload.historySessionId, preId);
      assert.equal(payload.providerSessionId, 'claude-session-aaa');

      // 3. Ingest step — as /api/history/ingest would call it
      const result = store.ingest({
        projectId,
        historySessionId: payload.historySessionId,
        providerId: payload.providerId,
        providerSessionId: payload.providerSessionId,
        summary: payload.summary,
        observations: payload.observations,
        // Hook passes source='provider-hook' — launcher source must win.
        source: 'provider-hook',
      });

      // 4. Assertions — same row, source survived, providerSessionId set, persona survived
      assert.equal(result.historySession.id, preId, 'no duplicate row created');

      const row = repo.getHistorySession(preId);
      assert.equal(row.personaId, personaId);
      assert.equal(row.providerSessionId, 'claude-session-aaa');
      assert.equal(row.source, 'launcher', 'launcher source is authoritative');

      // 5. No duplicate: count rows for this project — should be exactly 1
      const countRow = db
        .prepare('SELECT COUNT(*) AS c FROM history_session WHERE project_id = ?')
        .get(projectId);
      assert.equal(countRow.c, 1, 'exactly one history_session row for this project');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
