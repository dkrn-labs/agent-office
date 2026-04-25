import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveSessionTracker } from '../../src/telemetry/live-session-tracker.js';

describe('live session tracker — unattended fallback', () => {
  it('drops the session when no launch and no createUnattended callback', () => {
    const tracker = createLiveSessionTracker({ providerId: 'claude-code', idleMs: 1000 });
    const updates = [];
    tracker.on('session:update', (snap) => updates.push(snap));

    const snap = tracker.updateAbsolute({
      providerId: 'claude-code',
      providerSessionId: 'nope-1',
      projectPath: '/tmp/ghost',
      lastActivity: new Date().toISOString(),
      totals: { tokensIn: 10, tokensOut: 0, cacheRead: 0, cacheWrite: 0 },
    });

    assert.equal(snap, null);
    assert.equal(updates.length, 0);
  });

  it('registers an unattended session when createUnattended returns a sessionId', () => {
    const calls = [];
    const tracker = createLiveSessionTracker({
      providerId: 'claude-code',
      idleMs: 1000,
      createUnattended: (info) => {
        calls.push(info);
        return { sessionId: 7, projectId: 3, personaId: null, startedAt: info.lastActivity };
      },
    });
    const updates = [];
    tracker.on('session:update', (snap) => updates.push(snap));

    // Use "now" so the tracker's staleness gate (rejects unattended
    // registrations whose lastActivity is past expiryMs) doesn't drop this.
    const lastActivity = new Date().toISOString();
    const snap = tracker.updateAbsolute({
      providerId: 'claude-code',
      providerSessionId: 'term-abc',
      projectPath: '/tmp/term-project',
      lastActivity,
      totals: { tokensIn: 10, tokensOut: 5, cacheRead: 0, cacheWrite: 0 },
    });

    assert.ok(snap, 'snapshot should be emitted');
    assert.equal(snap.sessionId, 7);
    assert.equal(snap.projectId, 3);
    assert.equal(snap.personaId, null);
    assert.equal(snap.providerSessionId, 'term-abc');
    assert.equal(snap.unattended, true);
    assert.equal(updates.length, 1);
    assert.deepEqual(calls, [{
      providerId: 'claude-code',
      providerSessionId: 'term-abc',
      projectPath: '/tmp/term-project',
      lastActivity,
    }]);
  });

  it('still drops when createUnattended returns null (e.g. unknown project)', () => {
    const tracker = createLiveSessionTracker({
      providerId: 'claude-code',
      idleMs: 1000,
      createUnattended: () => null,
    });
    const updates = [];
    tracker.on('session:update', (snap) => updates.push(snap));

    const snap = tracker.updateAbsolute({
      providerId: 'claude-code',
      providerSessionId: 'term-xyz',
      projectPath: '/tmp/unknown',
      lastActivity: new Date().toISOString(),
      totals: { tokensIn: 1, tokensOut: 1, cacheRead: 0, cacheWrite: 0 },
    });

    assert.equal(snap, null);
    assert.equal(updates.length, 0);
  });
});
