import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { buildHistoryIngestPayload } from '../../src/history/hook-bridge.js';

describe('buildHistoryIngestPayload', () => {
  it('maps Claude Stop hook payloads into history ingest payloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-hook-bridge-'));
    const transcriptPath = join(dir, 'claude.jsonl');
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'change it' },
      })}\n${JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/project/app.js' } }],
        },
      })}\n`,
      'utf8',
    );
    const payload = buildHistoryIngestPayload('claude-code', {
      session_id: 'claude-1',
      cwd: '/tmp/project',
      hook_event_name: 'Stop',
      transcript_path: transcriptPath,
      last_assistant_message: 'Implemented the route.',
    });

    assert.equal(payload.providerId, 'claude-code');
    assert.equal(payload.projectPath, '/tmp/project');
    assert.equal(payload.providerSessionId, 'claude-1');
    assert.equal(payload.summary.completed, 'Implemented the route.');
    assert.deepEqual(payload.summary.filesEdited, ['/tmp/project/app.js']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('maps Gemini AfterAgent payloads into history ingest payloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-hook-bridge-'));
    const transcriptPath = join(dir, 'gemini.json');
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        messages: [
          { type: 'user', content: [{ text: 'implement history ingestion' }] },
          { type: 'gemini', toolCalls: [{ name: 'write_file', args: { path: '/tmp/project/route.js' } }] },
        ],
      }),
      'utf8',
    );
    const payload = buildHistoryIngestPayload('gemini-cli', {
      session_id: 'gemini-1',
      cwd: '/tmp/project',
      hook_event_name: 'AfterAgent',
      transcript_path: transcriptPath,
      prompt: 'implement history ingestion',
      prompt_response: 'Done. Added the endpoint.',
    });

    assert.equal(payload.providerId, 'gemini-cli');
    assert.equal(payload.summary.request, 'implement history ingestion');
    assert.equal(payload.summary.completed, 'Done. Added the endpoint.');
    assert.deepEqual(payload.summary.filesEdited, ['/tmp/project/route.js']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when a provider payload lacks enough context to ingest', () => {
    const payload = buildHistoryIngestPayload('gemini-cli', {
      hook_event_name: 'SessionEnd',
      reason: 'exit',
    });

    assert.equal(payload, null);
  });

  it('maps Codex notify payloads into enriched history ingest payloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-hook-bridge-'));
    const stateDbPath = join(dir, 'state.sqlite');
    const logsDbPath = join(dir, 'logs.sqlite');
    const stateDb = new Database(stateDbPath);
    const logsDb = new Database(logsDbPath);

    stateDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    logsDb.exec(`
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        ts_nanos INTEGER NOT NULL,
        thread_id TEXT,
        feedback_log_body TEXT
      );
    `);

    stateDb.prepare(`INSERT INTO threads (id, cwd, updated_at) VALUES (?, ?, ?)`).run('thread-1', '/tmp/project', 100);
    logsDb
      .prepare(`INSERT INTO logs (ts, ts_nanos, thread_id, feedback_log_body) VALUES (?, ?, ?, ?)`)
      .run(100, 0, 'thread-1', 'ToolCall: exec_command {"cmd":"git add /tmp/project/src/hook.js","workdir":"/tmp/project"}');

    stateDb.close();
    logsDb.close();

    process.env.CODEX_STATE_DB_PATH = stateDbPath;
    process.env.CODEX_LOGS_DB_PATH = logsDbPath;
    const payload = buildHistoryIngestPayload(
      'codex',
      { type: 'agent-turn-complete', message: 'Completed Codex turn.' },
      { cwd: '/tmp/project' },
    );

    assert.equal(payload.providerId, 'codex');
    assert.equal(payload.projectPath, '/tmp/project');
    assert.deepEqual(payload.summary.filesEdited, ['/tmp/project/src/hook.js']);

    delete process.env.CODEX_STATE_DB_PATH;
    delete process.env.CODEX_LOGS_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });
});
