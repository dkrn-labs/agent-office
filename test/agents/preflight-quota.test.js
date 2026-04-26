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

  describe('P4-A — abtop snapshot path', () => {
    it('blocks when ctxPct >= 0.99 on a matching session', async () => {
      const r = await checkQuotaBeforeSpawn({
        providerId: 'claude-code',
        abtopSnapshot: () => ({ sessions: [{ pid: 1, model: 'opus-4-7', ctxPct: 0.99 }] }),
      });
      assert.equal(r.ok, false);
      assert.equal(r.source, 'abtop');
      assert.match(r.reason, /context window is full/);
      assert.equal(r.quotaPct, 0.99);
    });

    it('blocks when status is rate-limited regardless of ctxPct', async () => {
      const r = await checkQuotaBeforeSpawn({
        providerId: 'claude-code',
        abtopSnapshot: () => ({ sessions: [{ pid: 9, model: 'opus-4-7', ctxPct: 0.30, status: 'rate-limited' }] }),
      });
      assert.equal(r.ok, false);
      assert.match(r.reason, /rate-limited/);
    });

    it('lets through when ctxPct is below threshold', async () => {
      const r = await checkQuotaBeforeSpawn({
        providerId: 'claude-code',
        abtopSnapshot: () => ({ sessions: [{ pid: 2, model: 'opus-4-7', ctxPct: 0.50 }] }),
      });
      assert.equal(r.ok, true);
      assert.equal(r.quotaPct, 0.50);
      assert.equal(r.source, 'abtop');
    });

    it('falls through to legacy getter when no matching abtop session', async () => {
      const r = await checkQuotaBeforeSpawn({
        providerId: 'codex',
        abtopSnapshot: () => ({ sessions: [{ pid: 3, model: 'opus-4-7', ctxPct: 0.99 }] }),
        getQuotaForProvider: async () => 0.10,
      });
      assert.equal(r.ok, true);
      assert.equal(r.source, 'cli');
      assert.equal(r.quotaPct, 0.10);
    });

    it('maps gpt- model prefix to codex', async () => {
      const r = await checkQuotaBeforeSpawn({
        providerId: 'codex',
        abtopSnapshot: () => ({ sessions: [{ pid: 4, model: 'gpt-5.5-codex', ctxPct: 0.99 }] }),
      });
      assert.equal(r.ok, false);
      assert.equal(r.source, 'abtop');
    });
  });
});
