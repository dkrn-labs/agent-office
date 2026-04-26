import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import geminiAdapter from '../../src/providers/gemini-cli.js';

describe('gemini-cli adapter — contract surface', () => {
  it('exposes installHook, parseTranscript, telemetry.sample, quota', () => {
    assert.equal(typeof geminiAdapter.installHook, 'function');
    assert.equal(typeof geminiAdapter.parseTranscript, 'function');
    assert.equal(typeof geminiAdapter.telemetry?.sample, 'function');
    assert.equal(typeof geminiAdapter.quota, 'function');
  });

  it('parseTranscript reads a session JSON file and returns one summary event', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-tx-'));
    const filePath = path.join(tmp, 'session-abc.json');
    fs.writeFileSync(filePath, JSON.stringify({
      sessionId: 'abc',
      lastUpdated: '2026-04-26T10:00:00Z',
      messages: [
        { type: 'user', timestamp: '2026-04-26T09:59:55Z' },
        { type: 'gemini', model: 'gemini-3-flash-preview', timestamp: '2026-04-26T10:00:00Z',
          tokens: { input: 200, output: 60, cached: 10, total: 270 } },
      ],
    }));
    const events = geminiAdapter.parseTranscript(filePath);
    assert.equal(events.length, 1);
    assert.equal(events[0].providerSessionId, 'abc');
    assert.equal(events[0].lastModel, 'gemini-3-flash-preview');
    assert.equal(events[0].totals.tokensIn, 200);
    assert.equal(events[0].totals.tokensOut, 60);
  });

  it('parseTranscript returns [] for missing or malformed file', () => {
    assert.deepEqual(geminiAdapter.parseTranscript('/nonexistent.json'), []);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-tx-'));
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, 'not json{');
    assert.deepEqual(geminiAdapter.parseTranscript(bad), []);
  });

  it('telemetry.sample reads launch_budget via injected repo', () => {
    const fakeRepo = {
      getLaunchBudgetForSession() { return { tokensInOptimized: 300, tokensOutOptimized: 40, costDollars: 0.0008 }; },
    };
    const out = geminiAdapter.telemetry.sample(7, { repo: fakeRepo });
    assert.deepEqual(out, { inputTokens: 300, outputTokens: 40, costDollars: 0.0008 });
  });

  it('quota returns null until P4 abtop bridge', async () => {
    assert.equal(await geminiAdapter.quota(), null);
  });

  it('installHook is idempotent', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-home-'));
    const r1 = await geminiAdapter.installHook({ home, hookScript: '/tmp/hook.js' });
    assert.equal(r1.changed, true);
    const r2 = await geminiAdapter.installHook({ home, hookScript: '/tmp/hook.js' });
    assert.equal(r2.changed, false);
  });
});
