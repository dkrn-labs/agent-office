import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import {
  enrichClaudeTurn,
  enrichCodexTurn,
  enrichGeminiTurn,
  extractNextSteps,
} from '../../src/history/transcript-extractors.js';

let dir;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-history-extractors-'));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('extractNextSteps', () => {
  it('pulls the first next-steps bullet from assistant text', () => {
    const next = extractNextSteps('Done.\n\nNext steps:\n- Run the full test suite\n- Ship it');
    assert.equal(next, 'Run the full test suite');
  });
});

describe('enrichClaudeTurn', () => {
  it('extracts edited and read files from the latest Claude turn', () => {
    const transcriptPath = join(dir, 'claude.jsonl');
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'make the change' } }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/project/src/old.js' } },
              { type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/project/src/new.js' } },
            ],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Implemented the change.' }],
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const result = enrichClaudeTurn({
      transcriptPath,
      responseText: 'Implemented the change.\n\nNext steps: run tests.',
      createdAt: '2026-04-16T12:00:00.000Z',
    });

    assert.deepEqual(result.filesRead, ['/tmp/project/src/old.js']);
    assert.deepEqual(result.filesEdited, ['/tmp/project/src/new.js']);
    assert.equal(result.nextSteps, 'run tests.');
    assert.equal(result.observations.length, 1);
  });
});

describe('enrichGeminiTurn', () => {
  it('extracts edited and read files from the latest Gemini turn', () => {
    const transcriptPath = join(dir, 'gemini.json');
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        sessionId: 'g-1',
        messages: [
          { type: 'user', content: [{ text: 'fix it' }] },
          {
            type: 'gemini',
            toolCalls: [
              { name: 'read_file', args: { path: '/tmp/project/src/a.js' } },
              { name: 'write_file', args: { path: '/tmp/project/src/b.js' } },
            ],
          },
          {
            type: 'gemini',
            content: 'Done.\n\nNext steps:\n- verify it',
          },
        ],
      }),
      'utf8',
    );

    const result = enrichGeminiTurn({
      transcriptPath,
      responseText: 'Done.\n\nNext steps:\n- verify it',
      createdAt: '2026-04-16T12:05:00.000Z',
    });

    assert.deepEqual(result.filesRead, ['/tmp/project/src/a.js']);
    assert.deepEqual(result.filesEdited, ['/tmp/project/src/b.js']);
    assert.equal(result.nextSteps, 'verify it');
    assert.equal(result.observations.length, 1);
  });
});

describe('enrichCodexTurn', () => {
  it('extracts best-effort file activity from Codex state and logs', () => {
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

    stateDb
      .prepare(`INSERT INTO threads (id, cwd, updated_at) VALUES (?, ?, ?)`)
      .run('thread-1', '/tmp/project', 100);
    logsDb
      .prepare(`INSERT INTO logs (ts, ts_nanos, thread_id, feedback_log_body) VALUES (?, ?, ?, ?)`)
      .run(
        100,
        0,
        'thread-1',
        'ToolCall: exec_command {"cmd":"sed -n \'1,120p\' /tmp/project/src/a.js","workdir":"/tmp/project"}',
      );
    logsDb
      .prepare(`INSERT INTO logs (ts, ts_nanos, thread_id, feedback_log_body) VALUES (?, ?, ?, ?)`)
      .run(
        101,
        0,
        'thread-1',
        'ToolCall: exec_command {"cmd":"git add /tmp/project/src/b.js","workdir":"/tmp/project"}',
      );

    stateDb.close();
    logsDb.close();

    const result = enrichCodexTurn({
      logsDbPath,
      stateDbPath,
      cwd: '/tmp/project',
      responseText: 'Completed the update. Next steps: review the diff.',
      createdAt: '2026-04-16T12:10:00.000Z',
    });

    assert.deepEqual(result.filesRead, ['/tmp/project/src/a.js']);
    assert.deepEqual(result.filesEdited, ['/tmp/project/src/b.js']);
    assert.equal(result.nextSteps, 'review the diff.');
    assert.equal(result.observations.length, 1);
  });
});
