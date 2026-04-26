import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { installHooksForAdapters } from '../../src/providers/install-hooks-on-boot.js';

describe('installHooksForAdapters', () => {
  it('calls installHook on every adapter that defines it', async () => {
    const calls = [];
    const adapters = [
      { id: 'a', installHook: async () => { calls.push('a'); return { provider: 'a', changed: true }; } },
      { id: 'b', installHook: async () => { calls.push('b'); return { provider: 'b', changed: false, reason: 'already installed' }; } },
      { id: 'c' /* no installHook */ },
    ];
    const results = await installHooksForAdapters(adapters);
    assert.deepEqual(calls.sort(), ['a', 'b']);
    assert.equal(results.length, 2);
    assert.ok(results.some((r) => r.provider === 'a' && r.changed === true));
  });

  it('does not throw when an adapter rejects — it logs and continues', async () => {
    const logs = [];
    const log = { warn: (msg) => logs.push(msg), info: () => {} };
    const adapters = [
      { id: 'good', installHook: async () => ({ provider: 'good', changed: false }) },
      { id: 'bad', installHook: async () => { throw new Error('boom'); } },
    ];
    const results = await installHooksForAdapters(adapters, { log });
    // Only successful one is in results; failure is logged.
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'good');
    assert.equal(logs.length, 1);
    assert.match(logs[0], /bad.*boom/);
  });

  it('runs in parallel (Promise.allSettled, not sequential)', async () => {
    const order = [];
    const adapters = [
      { id: 'slow', installHook: async () => { await new Promise((r) => setTimeout(r, 30)); order.push('slow'); return { provider: 'slow', changed: false }; } },
      { id: 'fast', installHook: async () => { order.push('fast'); return { provider: 'fast', changed: false }; } },
    ];
    await installHooksForAdapters(adapters);
    assert.deepEqual(order, ['fast', 'slow']);
  });
});
