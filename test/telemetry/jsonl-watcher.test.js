import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createJsonlWatcher, parseUsageLine } from '../../src/telemetry/jsonl-watcher.js';

function waitFor(check, timeoutMs = 1000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('timed out waiting for watcher event'));
      }
    }, 20);
  });
}

describe('parseUsageLine', () => {
  it('returns null for malformed or irrelevant lines', () => {
    assert.equal(parseUsageLine(''), null);
    assert.equal(parseUsageLine('not-json'), null);
    assert.equal(parseUsageLine(JSON.stringify({ message: {} })), null);
  });

  it('extracts tokens and model', () => {
    const parsed = parseUsageLine(JSON.stringify({
      sessionId: 'provider-1',
      cwd: '/tmp/project',
      timestamp: '2026-04-15T08:00:00.000Z',
      message: {
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
        },
      },
    }));

    assert.deepEqual(parsed, {
      providerSessionId: 'provider-1',
      cwd: '/tmp/project',
      timestamp: '2026-04-15T08:00:00.000Z',
      model: 'claude-sonnet-4-6',
      tokensIn: 10,
      tokensOut: 20,
      cacheRead: 30,
      cacheWrite: 40,
    });
  });
});

describe('createJsonlWatcher', () => {
  it('correlates a launch and emits update/idle events from jsonl writes', async () => {
    const projectPath = '/tmp/agent-office-project';
    const watcher = createJsonlWatcher({ idleMs: 50, expiryMs: 90 });
    const updates = [];
    const idles = [];
    const expired = [];
    watcher.on('session:update', (payload) => updates.push(payload));
    watcher.on('session:idle', (payload) => idles.push(payload));
    watcher.on('session:expired', (payload) => expired.push(payload));
    watcher.registerLaunch({
      projectPath,
      sessionId: 42,
      personaId: 7,
      projectId: 9,
      launchedAt: '2026-04-15T08:00:00.000Z',
    });

    watcher.ingestUsage('provider-1', projectPath, {
      providerSessionId: 'provider-1',
      cwd: projectPath,
      timestamp: '2026-04-15T08:01:00.000Z',
      model: 'claude-sonnet-4-6',
      tokensIn: 100,
      tokensOut: 50,
      cacheRead: 10,
      cacheWrite: 5,
    });

    await waitFor(() => updates.length === 1);
    assert.equal(updates[0].sessionId, 42);
    assert.equal(updates[0].personaId, 7);
    assert.equal(updates[0].projectId, 9);
    assert.equal(updates[0].providerSessionId, 'provider-1');
    assert.equal(updates[0].totals.total, 165);

    await waitFor(() => idles.length === 1);
    assert.equal(idles[0].sessionId, 42);
    assert.equal(watcher.snapshot().length, 1);
    assert.equal(watcher.snapshot()[0].working, false);

    watcher.ingestUsage('provider-1', projectPath, {
      providerSessionId: 'provider-1',
      cwd: projectPath,
      timestamp: '2026-04-15T08:01:30.000Z',
      model: 'claude-sonnet-4-6',
      tokensIn: 5,
      tokensOut: 5,
      cacheRead: 0,
      cacheWrite: 0,
    });

    await waitFor(() => updates.length === 2);
    assert.equal(updates[1].sessionId, 42);
    assert.equal(watcher.snapshot()[0].working, true);

    await waitFor(() => expired.length === 1);
    assert.equal(expired[0].sessionId, 42);
    assert.deepEqual(watcher.snapshot(), []);

    await watcher.stop();
  });
});
