import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createGeminiWatcher,
  parseGeminiSession,
  DEFAULT_GEMINI_IDLE_MS,
} from '../../src/telemetry/gemini-watcher.js';

describe('parseGeminiSession', () => {
  it('extracts totals and model from a Gemini chat session file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-gemini-parse-'));
    const file = join(dir, 'session.json');
    writeFileSync(file, JSON.stringify({
      sessionId: 'gem-session-1',
      lastUpdated: '2026-04-15T18:23:02.534Z',
      messages: [
        { type: 'user', timestamp: '2026-04-15T18:22:59.630Z' },
        {
          type: 'gemini',
          timestamp: '2026-04-15T18:23:02.534Z',
          model: 'gemini-3-flash-preview',
          tokens: { input: 100, output: 25, cached: 10, total: 135 },
        },
      ],
    }), 'utf8');

    const parsed = parseGeminiSession(file);
    rmSync(dir, { recursive: true, force: true });

    assert.equal(parsed.providerSessionId, 'gem-session-1');
    assert.equal(parsed.lastModel, 'gemini-3-flash-preview');
    assert.equal(parsed.totals.tokensIn, 100);
    assert.equal(parsed.totals.tokensOut, 25);
    assert.equal(parsed.totals.cacheRead, 10);
    assert.equal(parsed.totals.total, 135);
  });
});

describe('createGeminiWatcher', () => {
  it('uses a long enough default idle window for Gemini CLI sessions', () => {
    assert.equal(DEFAULT_GEMINI_IDLE_MS, 90_000);
  });

  it('correlates a launch with a Gemini session file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-office-gemini-watch-'));
    const projectDir = join(root, 'project-a');
    const chatsDir = join(projectDir, 'chats');
    mkdirSync(chatsDir, { recursive: true });
    writeFileSync(join(projectDir, '.project_root'), '/tmp/gemini-project', 'utf8');
    writeFileSync(join(chatsDir, 'session-1.json'), JSON.stringify({
      sessionId: 'gem-session-1',
      startTime: '2026-04-15T18:00:00.000Z',
      lastUpdated: '2026-04-15T18:01:00.000Z',
      messages: [
        {
          type: 'gemini',
          timestamp: '2026-04-15T18:01:00.000Z',
          model: 'gemini-3-flash-preview',
          tokens: { input: 200, output: 50, cached: 5, total: 255 },
        },
      ],
    }), 'utf8');

    const watcher = createGeminiWatcher({ rootPath: root, pollMs: 60_000, idleMs: 60_000 });
    const updates = [];
    watcher.on('session:update', (payload) => updates.push(payload));
    watcher.registerLaunch({
      providerId: 'gemini-cli',
      projectPath: '/tmp/gemini-project',
      sessionId: 44,
      personaId: 3,
      projectId: 8,
      launchedAt: '2026-04-15T17:59:00.000Z',
    });

    watcher.pollOnce();
    await watcher.stop();
    rmSync(root, { recursive: true, force: true });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].sessionId, 44);
    assert.equal(updates[0].providerSessionId, 'gem-session-1');
    assert.equal(updates[0].totals.total, 255);
  });
});
