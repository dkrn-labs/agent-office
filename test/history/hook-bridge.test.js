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
        updated_at INTEGER NOT NULL,
        first_user_message TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT ''
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

    stateDb
      .prepare(`INSERT INTO threads (id, cwd, updated_at, first_user_message, title) VALUES (?, ?, ?, ?, ?)`)
      .run('thread-1', '/tmp/project', 100, 'Make Codex history useful', 'Codex history enrichment');
    logsDb
      .prepare(`INSERT INTO logs (ts, ts_nanos, thread_id, feedback_log_body) VALUES (?, ?, ?, ?)`)
      .run(
        100,
        0,
        'thread-1',
        'session_loop{thread_id=thread-1}:submission_dispatch{submission.id=codex-turn-1}: ToolCall: exec_command {"cmd":"git add /tmp/project/src/hook.js","workdir":"/tmp/project"}',
      );

    stateDb.close();
    logsDb.close();

    process.env.CODEX_STATE_DB_PATH = stateDbPath;
    process.env.CODEX_LOGS_DB_PATH = logsDbPath;
    const payload = buildHistoryIngestPayload(
      'codex',
      { type: 'agent-turn-complete', session_id: 'codex-turn-1' },
      { cwd: '/tmp/project' },
    );

    assert.equal(payload.providerId, 'codex');
    assert.equal(payload.projectPath, '/tmp/project');
    // P1-3 — providerSessionId now reports the resolved thread id (matches
    // the watcher's row), not the turn id from the notify payload.
    assert.equal(payload.providerSessionId, 'thread-1');
    assert.equal(payload.summary.request, 'Make Codex history useful');
    assert.equal(payload.summary.completed, 'Updated hook.js.');
    assert.deepEqual(payload.summary.filesEdited, ['/tmp/project/src/hook.js']);

    delete process.env.CODEX_STATE_DB_PATH;
    delete process.env.CODEX_LOGS_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to turn_id when the codex thread cannot be resolved (P1-3)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-hook-bridge-'));
    const stateDbPath = join(dir, 'state.sqlite');
    const logsDbPath = join(dir, 'logs.sqlite');
    const stateDb = new Database(stateDbPath);
    const logsDb = new Database(logsDbPath);
    stateDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        first_user_message TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT ''
      );
    `);
    // Empty logs table — no thread can be resolved from the turn id.
    logsDb.exec(`
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        ts_nanos INTEGER NOT NULL,
        thread_id TEXT,
        feedback_log_body TEXT
      );
    `);
    stateDb.close();
    logsDb.close();

    process.env.CODEX_STATE_DB_PATH = stateDbPath;
    process.env.CODEX_LOGS_DB_PATH = logsDbPath;
    const payload = buildHistoryIngestPayload(
      'codex',
      { type: 'agent-turn-complete', session_id: 'orphan-turn-9' },
      { cwd: '/tmp/project' },
    );

    assert.equal(payload.providerSessionId, 'orphan-turn-9');

    delete process.env.CODEX_STATE_DB_PATH;
    delete process.env.CODEX_LOGS_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('propagates opts.historySessionId into the payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-hook-bridge-'));
    const transcriptPath = join(dir, 'claude.jsonl');
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      })}\n`,
      'utf8',
    );
    const payload = buildHistoryIngestPayload(
      'claude-code',
      {
        session_id: 'claude-x',
        cwd: '/tmp/project',
        hook_event_name: 'Stop',
        transcript_path: transcriptPath,
        last_assistant_message: 'done',
      },
      { historySessionId: 4242 },
    );
    assert.equal(payload.historySessionId, 4242);
    rmSync(dir, { recursive: true, force: true });
  });
});
