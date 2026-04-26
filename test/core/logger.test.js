import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';

import { createLogger, redactSecretsInString } from '../../src/core/logger.js';

function captureStream() {
  const stream = new Writable({
    write(chunk, _enc, cb) { stream.lines.push(String(chunk)); cb(); },
  });
  stream.lines = [];
  return stream;
}

function parseLines(stream) {
  const out = [];
  for (const chunk of stream.lines) {
    for (const line of chunk.split('\n')) {
      const t = line.trim();
      if (t) out.push(JSON.parse(t));
    }
  }
  return out;
}

describe('createLogger — legacy module-name shape', () => {
  it('info — writes correct timestamp, level, module', () => {
    const stream = captureStream();
    const logger = createLogger({ module: 'test-module', destination: stream });
    const before = Date.now();
    logger.info('hello');
    const after = Date.now();

    const [entry] = parseLines(stream);
    assert.equal(entry.level, 'info');
    assert.equal(entry.module, 'test-module');
    assert.equal(entry.msg, 'hello');
    assert.ok(typeof entry.ts === 'string', 'ts should be a string');
    const ts = new Date(entry.ts).getTime();
    assert.ok(ts >= before && ts <= after, 'ts should be within test window');
  });

  it('warn — includes extra data fields', () => {
    const stream = captureStream();
    const logger = createLogger({ module: 'warn-module', destination: stream });
    logger.warn('low memory', { available: 512 });
    const [entry] = parseLines(stream);
    assert.equal(entry.level, 'warn');
    assert.equal(entry.module, 'warn-module');
    assert.equal(entry.msg, 'low memory');
    assert.equal(entry.available, 512);
  });

  it('error — includes extra data fields', () => {
    const stream = captureStream();
    const logger = createLogger({ module: 'error-module', destination: stream });
    logger.error('boom', { code: 'ERR_CRASH', retries: 3 });
    const [entry] = parseLines(stream);
    assert.equal(entry.level, 'error');
    assert.equal(entry.module, 'error-module');
    assert.equal(entry.msg, 'boom');
    assert.equal(entry.code, 'ERR_CRASH');
    assert.equal(entry.retries, 3);
  });

  it('accepts a string argument as the module name (legacy form)', () => {
    const stream = captureStream();
    const logger = createLogger('legacy-call');
    // Stream injection is keyed off options object, so the legacy form
    // writes to real stdout — just verify the function returns the
    // expected interface.
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.warn, 'function');
    assert.equal(typeof logger.error, 'function');
  });
});

describe('redactSecretsInString', () => {
  it('redacts the same key shapes the abtop parser does', () => {
    const fakeKey = 'sk_' + 'test_' + 'X'.repeat(24);
    assert.match(redactSecretsInString(`Authorization: Bearer ${fakeKey}`), /sk_test_REDACTED/);
    assert.match(redactSecretsInString('AKIAIOSFODNN7XYZAAAA'), /AKIA_REDACTED/);
  });
});

describe('createLogger — secret redaction', () => {
  it('redacts secrets that appear inside the message string', () => {
    const stream = captureStream();
    const log = createLogger({ destination: stream });
    const fakeKey = 'sk_' + 'test_' + 'A'.repeat(20);
    log.info(`auth header had ${fakeKey} attached`);
    const [obj] = parseLines(stream);
    assert.match(obj.msg, /sk_test_REDACTED/);
    assert.ok(!obj.msg.includes(fakeKey));
  });

  it('redacts secrets in nested meta values', () => {
    const stream = captureStream();
    const log = createLogger({ destination: stream });
    const fakeKey = 'sk_' + 'live_' + 'B'.repeat(20);
    log.warn('webhook fired', { request: { headers: { authorization: `Bearer ${fakeKey}` } } });
    const [obj] = parseLines(stream);
    assert.match(obj.request.headers.authorization, /sk_live_REDACTED/);
  });

  it('respects the configured log level', () => {
    const stream = captureStream();
    const log = createLogger({ destination: stream, level: 'warn' });
    log.info('should be filtered out');
    log.warn('should be kept');
    const lines = parseLines(stream);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].msg, 'should be kept');
  });
});
