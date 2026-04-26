import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAbtopBridge } from '../../src/telemetry/abtop-bridge.js';

function makeFakeRunner(outputs) {
  let i = 0;
  return async function fakeRunner() {
    const out = outputs[Math.min(i, outputs.length - 1)];
    i++;
    return { ok: true, stdout: out };
  };
}

const ONE = `abtop — 1 session

  100 proj(abc1234)        do a thing ◌ Wait opus-4-7   CTX: 50% Tok:10.0M Mem:200M 1h 0m
       └─ working
       101 npm exec ctx7 0K
`;

const ONE_CHANGED = `abtop — 1 session

  100 proj(abc1234)        do a thing ◌ Wait opus-4-7   CTX: 60% Tok:12.0M Mem:210M 1h 1m
       └─ still working
       101 npm exec ctx7 0K
`;

describe('createAbtopBridge', () => {
  it('snapshot() returns parsed sessions on the first poll', async () => {
    const bridge = createAbtopBridge({ binPath: 'abtop', pollMs: 10_000, runner: makeFakeRunner([ONE]) });
    await bridge.refresh();
    const snap = bridge.snapshot();
    assert.equal(snap.sessions.length, 1);
    assert.equal(snap.sessions[0].pid, 100);
  });

  it('emits session:detail:tick only when fields change', async () => {
    const bridge = createAbtopBridge({ binPath: 'abtop', pollMs: 10_000, runner: makeFakeRunner([ONE, ONE, ONE_CHANGED]) });
    const ticks = [];
    bridge.on('session:detail:tick', (e) => ticks.push(e));

    await bridge.refresh();              // first ever — emits
    await bridge.refresh();              // identical — no emit
    await bridge.refresh();              // changed CTX/Tok — emits

    assert.equal(ticks.length, 2);
    assert.equal(ticks[0].pid, 100);
    assert.equal(ticks[0].ctxPct, 0.5);
    assert.equal(ticks[1].ctxPct, 0.6);
  });

  it('does not throw when execFile errors — logs + keeps going', async () => {
    const runner = async () => ({ ok: false, error: new Error('ENOENT'), stdout: '' });
    const logs = [];
    const bridge = createAbtopBridge({ binPath: 'abtop', pollMs: 10_000, runner, log: { warn: (m) => logs.push(m), info: () => {} } });
    await bridge.refresh();
    assert.deepEqual(bridge.snapshot().sessions, []);
    assert.ok(logs.some((m) => /ENOENT/.test(m)));
  });

  it('start/stop schedules + clears the poll timer', async () => {
    let calls = 0;
    const runner = async () => { calls++; return { ok: true, stdout: ONE }; };
    const bridge = createAbtopBridge({ binPath: 'abtop', pollMs: 20, runner });
    await bridge.start();
    await new Promise((r) => setTimeout(r, 60));
    await bridge.stop();
    const after = calls;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls, after, 'no further polls after stop');
    assert.ok(after >= 2, 'expected at least 2 polls during 60ms with pollMs=20');
  });
});
