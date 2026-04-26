import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkQuotaBeforeSpawn } from '../../src/agents/preflight-quota.js';

describe('preflight quota check (stub)', () => {
  it('returns ok:true when no getter is provided', async () => {
    const r = await checkQuotaBeforeSpawn({ providerId: 'claude-code' });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'stub');
    assert.equal(r.quotaPct, null);
  });

  it('returns ok:false when injected getter reports ≥0.99', async () => {
    const r = await checkQuotaBeforeSpawn({
      providerId: 'codex',
      getQuotaForProvider: async () => 0.995,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /quota window is exhausted/);
    assert.equal(r.quotaPct, 0.995);
  });

  it('returns ok:true when injected getter reports below the threshold', async () => {
    const r = await checkQuotaBeforeSpawn({
      providerId: 'codex',
      getQuotaForProvider: async () => 0.85,
    });
    assert.equal(r.ok, true);
    assert.equal(r.quotaPct, 0.85);
  });

  it('swallows getter errors and returns ok:true', async () => {
    const r = await checkQuotaBeforeSpawn({
      providerId: 'gemini-cli',
      getQuotaForProvider: async () => { throw new Error('abtop down'); },
    });
    assert.equal(r.ok, true);
    assert.equal(r.quotaPct, null);
  });

  it('honors bypass:true regardless of getter', async () => {
    const r = await checkQuotaBeforeSpawn({
      providerId: 'claude-code',
      getQuotaForProvider: async () => 1.0,
      bypass: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'override');
  });
});
