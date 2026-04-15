import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CODEX_IDLE_MS } from '../../src/telemetry/codex-watcher.js';

describe('createCodexWatcher', () => {
  it('uses a longer default idle window for Codex sessions', () => {
    assert.equal(DEFAULT_CODEX_IDLE_MS, 60_000);
  });
});
