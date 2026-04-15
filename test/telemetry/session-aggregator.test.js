import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { ACTIVITY_TICK } from '../../src/core/events.js';
import { createAggregator } from '../../src/telemetry/session-aggregator.js';

let dir;
let db;
let repo;
let projectId;
let personaId;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ao-aggregator-test-'));
  db = openDatabase(join(dir, 'test.db'));
  await runMigrations(db);
  repo = createRepository(db);

  projectId = Number(repo.createProject({ path: '/tmp/proj', name: 'proj' }));
  personaId = Number(repo.createPersona({
    label: 'Frontend',
    domain: 'frontend',
    secondaryDomains: [],
    skillIds: [],
    source: 'test',
  }));

  const now = new Date().toISOString();
  const sessionId = repo.createSession({ projectId, personaId, startedAt: now });
  repo.updateSession(sessionId, {
    endedAt: now,
    tokensIn: 100,
    tokensOut: 50,
    commitsProduced: 2,
  });
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createAggregator', () => {
  it('computes stats and pulse buckets', () => {
    const bus = createEventBus();
    const aggregator = createAggregator({
      repo,
      bus,
      claudeMem: {
        getObservations() {
          return [
            { createdAt: new Date().toISOString(), filesModified: ['src/a.js', 'src/b.js'] },
          ];
        },
      },
      watcher: {
        snapshot() {
          return [
            {
              sessionId: 999,
              lastActivity: new Date().toISOString(),
              totals: { total: 25 },
            },
          ];
        },
      },
    });

    const stats = aggregator.getTodayStats();
    assert.equal(stats.sessionsToday >= 1, true);
    assert.equal(stats.filesToday, 2);
    assert.equal(stats.commitsToday >= 2, true);
    assert.equal(stats.activeSessions, 1);

    const buckets = aggregator.getPulseBuckets();
    assert.equal(buckets.length, 6);
    assert.equal(buckets.some((bucket) => bucket.tokens > 0), true);
  });

  it('emits activity:tick payloads', () => {
    const bus = createEventBus();
    let payload = null;
    bus.on(ACTIVITY_TICK, (data) => {
      payload = data;
    });
    const aggregator = createAggregator({ repo, bus, claudeMem: null, watcher: null });
    aggregator.emitTick();
    assert.ok(payload);
    assert.equal(Array.isArray(payload.pulseBuckets), true);
    assert.equal(typeof payload.stats.sessionsToday, 'number');
  });
});
