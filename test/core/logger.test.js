import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/core/logger.js';

/**
 * Capture everything written to stdout during `fn()`.
 * Returns an array of parsed JSON objects (one per line written).
 */
async function captureStdout(fn) {
  const lines = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) lines.push(JSON.parse(trimmed));
    }
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return lines;
}

describe('createLogger', () => {
  it('info — writes correct timestamp and level', async () => {
    const logger = createLogger('test-module');
    const before = Date.now();
    const [entry] = await captureStdout(() => logger.info('hello'));
    const after = Date.now();

    assert.equal(entry.level, 'info');
    assert.equal(entry.module, 'test-module');
    assert.equal(entry.msg, 'hello');
    assert.ok(typeof entry.ts === 'string', 'ts should be a string');
    const ts = new Date(entry.ts).getTime();
    assert.ok(ts >= before && ts <= after, 'ts should be within test window');
  });

  it('warn — includes extra data fields', async () => {
    const logger = createLogger('warn-module');
    const [entry] = await captureStdout(() => logger.warn('low memory', { available: 512 }));

    assert.equal(entry.level, 'warn');
    assert.equal(entry.module, 'warn-module');
    assert.equal(entry.msg, 'low memory');
    assert.equal(entry.available, 512);
  });

  it('error — includes extra data fields', async () => {
    const logger = createLogger('error-module');
    const [entry] = await captureStdout(() => logger.error('boom', { code: 'ERR_CRASH', retries: 3 }));

    assert.equal(entry.level, 'error');
    assert.equal(entry.module, 'error-module');
    assert.equal(entry.msg, 'boom');
    assert.equal(entry.code, 'ERR_CRASH');
    assert.equal(entry.retries, 3);
  });
});
