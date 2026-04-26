import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createLmStudioBridge, LmStudioError } from '../../src/providers/lmstudio-bridge.js';

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

describe('lmstudio-bridge — healthCheck', () => {
  it('returns { ok: true } when /v1/models responds 200', async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /\/v1\/models$/);
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const bridge = createLmStudioBridge({ host: 'http://localhost:1234' });
    const out = await bridge.healthCheck();
    assert.equal(out.ok, true);
  });

  it('returns { ok: false, reason } on fetch rejection', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const bridge = createLmStudioBridge({ host: 'http://localhost:1234' });
    const out = await bridge.healthCheck();
    assert.equal(out.ok, false);
    assert.match(out.reason, /ECONNREFUSED/);
  });

  it('returns { ok: false, reason } on non-OK HTTP', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    const bridge = createLmStudioBridge({ host: 'http://localhost:1234' });
    const out = await bridge.healthCheck();
    assert.equal(out.ok, false);
    assert.match(out.reason, /500/);
  });

  it('caches healthy result for cacheMs window', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const bridge = createLmStudioBridge({ host: 'http://localhost:1234', cacheMs: 5000 });
    await bridge.healthCheck();
    await bridge.healthCheck();
    await bridge.healthCheck();
    assert.equal(calls, 1);
  });
});

describe('lmstudio-bridge — listModels', () => {
  it('returns the model id list from /v1/models', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'google/gemma-4-e4b' }, { id: 'qwen/qwen2.5-coder' }] }),
    });
    const bridge = createLmStudioBridge({ host: 'http://localhost:1234' });
    const ids = await bridge.listModels();
    assert.deepEqual(ids, ['google/gemma-4-e4b', 'qwen/qwen2.5-coder']);
  });

  it('throws LmStudioError on non-OK', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'down' });
    const bridge = createLmStudioBridge({ host: 'http://localhost:1234' });
    await assert.rejects(() => bridge.listModels(), LmStudioError);
  });
});

describe('lmstudio-bridge — complete', () => {
  it('POSTs to /v1/chat/completions with the supplied body and returns parsed JSON', async () => {
    let captured = null;
    globalThis.fetch = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
      };
    };
    const bridge = createLmStudioBridge({ host: 'http://localhost:1234' });
    const out = await bridge.complete({
      model: 'google/gemma-4-e4b',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 256,
      responseFormat: { type: 'json_object' },
    });
    assert.match(captured.url, /\/v1\/chat\/completions$/);
    const body = JSON.parse(captured.opts.body);
    assert.equal(body.model, 'google/gemma-4-e4b');
    assert.equal(body.temperature, 0);
    assert.equal(body.max_tokens, 256);
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(out.choices[0].message.content, 'hi');
  });

  it('throws LmStudioError on non-OK HTTP', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 502, text: async () => 'bad gateway' });
    const bridge = createLmStudioBridge({ host: 'http://localhost:1234' });
    await assert.rejects(
      () => bridge.complete({ model: 'm', messages: [] }),
      (err) => err instanceof LmStudioError && /502/.test(err.message),
    );
  });

  it('throws LmStudioError when fetch rejects', async () => {
    globalThis.fetch = async () => { throw new Error('socket hang up'); };
    const bridge = createLmStudioBridge({ host: 'http://localhost:1234' });
    await assert.rejects(
      () => bridge.complete({ model: 'm', messages: [] }),
      (err) => err instanceof LmStudioError && /socket hang up/.test(err.message),
    );
  });
});
