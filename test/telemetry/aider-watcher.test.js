import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createAiderWatcher, parseAiderHistory } from '../../src/telemetry/aider-watcher.js';

let tmpRoot;
beforeEach(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-watch-')); });
afterEach(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

describe('parseAiderHistory', () => {
  it('returns token estimates from the file content (chars/4)', () => {
    const content = 'a'.repeat(400); // 400 chars → 100 tokens
    const out = parseAiderHistory(content);
    assert.equal(out.estimatedTokens, 100);
    assert.equal(out.source, 'estimated');
  });

  it('handles empty input', () => {
    assert.equal(parseAiderHistory('').estimatedTokens, 0);
  });
});

describe('createAiderWatcher — register + poll', () => {
  it('emits session:update when the registered chat history grows', async () => {
    const projectPath = tmpRoot;
    const historyPath = path.join(projectPath, '.aider.chat.history.md');
    fs.writeFileSync(historyPath, '');

    const events = [];
    const watcher = createAiderWatcher({ pollMs: 50, idleMs: 100_000 });
    watcher.on('session:update', (e) => events.push({ type: 'update', ...e }));

    watcher.registerLaunch({
      providerSessionId: 'aider-1',
      projectPath,
      historySessionId: 1,
    });

    fs.writeFileSync(historyPath, 'hello aider\n'.repeat(20));
    await watcher.pollOnce();

    assert.ok(events.length >= 1, 'expected at least one session:update');
    const last = events[events.length - 1];
    assert.equal(last.providerSessionId, 'aider-1');
    assert.ok(last.totals.total > 0);
    await watcher.stop();
  });

  it('skips registered launches with no history file yet', async () => {
    const watcher = createAiderWatcher({ pollMs: 50 });
    watcher.registerLaunch({ providerSessionId: 'a', projectPath: tmpRoot, historySessionId: 1 });
    // No file written — pollOnce must not throw.
    await watcher.pollOnce();
    await watcher.stop();
  });

  it('threads historySessionId through to emitted events (issue #0003 fix)', async () => {
    const projectPath = tmpRoot;
    fs.writeFileSync(path.join(projectPath, '.aider.chat.history.md'), 'x'.repeat(80));

    const events = [];
    const watcher = createAiderWatcher({ pollMs: 50 });
    watcher.on('session:update', (e) => events.push(e));
    watcher.registerLaunch({ providerSessionId: 'aid', projectPath, historySessionId: 42 });
    await watcher.pollOnce();

    assert.ok(events.length >= 1);
    assert.equal(events[0].historySessionId, 42);
    await watcher.stop();
  });
});
