import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get as httpGet } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/api/server.js';
import { createRepository } from '../../src/db/repository.js';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { loadConfig } from '../../src/core/config.js';

function get(url) {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
  });
}

let base;
let httpServer;
let repo;
let configDir;
let app;
let projectId;
let personaId;
let launcherSessionId;
let unassignedSessionId;

before(async () => {
  configDir = mkdtempSync(join(tmpdir(), 'agent-office-history-sessions-'));
  const db = openDatabase(':memory:');
  await runMigrations(db);

  repo = createRepository(db);
  projectId = Number(repo.createProject({ path: '/test/hist-sessions', name: 'HS' }));
  personaId = Number(repo.createPersona({ label: 'Eng', domain: 'software' }));

  // 1) Launcher-created row with persona
  launcherSessionId = Number(
    repo.createHistorySession({
      projectId,
      personaId,
      providerId: 'claude-code',
      providerSessionId: 'claude-paired-1',
      startedAt: '2026-04-19T08:00:00.000Z',
      status: 'completed',
      model: 'claude-opus-4-7',
      source: 'launcher',
    }),
  );
  repo.createHistorySummary({
    historySessionId: launcherSessionId,
    projectId,
    providerId: 'claude-code',
    summaryKind: 'turn',
    completed: 'did the thing',
    nextSteps: 'do the next thing',
    createdAt: '2026-04-19T08:01:00.000Z',
    createdAtEpoch: Date.parse('2026-04-19T08:01:00.000Z'),
  });

  // 2) Hook-only row with NULL persona (terminal launch)
  unassignedSessionId = Number(
    repo.createHistorySession({
      projectId,
      personaId: null,
      providerId: 'claude-code',
      providerSessionId: 'claude-hook-only-1',
      startedAt: '2026-04-19T07:00:00.000Z',
      status: 'completed',
      source: 'provider-hook',
    }),
  );

  const bus = createEventBus();
  const config = loadConfig(configDir);
  app = createApp({ repo, bus, config, configDir });
  httpServer = createServer(app);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  app?.locals.stopTelemetry?.();
  return new Promise((resolve, reject) => {
    httpServer.close((err) => {
      rmSync(configDir, { recursive: true, force: true });
      if (err) reject(err);
      else resolve();
    });
  });
});

describe('GET /api/history/sessions', () => {
  it('lists every history_session for the project (launcher + provider-hook)', async () => {
    const { status, body } = await get(`${base}/api/history/sessions?projectId=${projectId}&pageSize=10`);
    assert.equal(status, 200);
    assert.equal(body.totalItems, 2);
    const ids = body.items.map((item) => item.id).sort();
    assert.deepEqual(ids, [launcherSessionId, unassignedSessionId].sort());
  });

  it('surfaces summary fields for the latest history_summary', async () => {
    const { body } = await get(`${base}/api/history/sessions?projectId=${projectId}&pageSize=10`);
    const launcherItem = body.items.find((item) => item.id === launcherSessionId);
    assert.equal(launcherItem.summaryCompleted, 'did the thing');
    assert.equal(launcherItem.summaryNextSteps, 'do the next thing');
    assert.equal(launcherItem.personaLabel, 'Eng');
  });

  it('filters by source=provider-hook', async () => {
    const { body } = await get(
      `${base}/api/history/sessions?projectId=${projectId}&source=provider-hook`,
    );
    assert.equal(body.totalItems, 1);
    assert.equal(body.items[0].id, unassignedSessionId);
    assert.equal(body.items[0].personaLabel, null);
  });

  it('filters unassigned=1 to rows with null persona', async () => {
    const { body } = await get(
      `${base}/api/history/sessions?projectId=${projectId}&unassigned=1`,
    );
    assert.equal(body.totalItems, 1);
    assert.equal(body.items[0].personaLabel, null);
    assert.equal(body.items[0].personaId, null);
  });

  it('filters by personaId and excludes unassigned rows', async () => {
    const { body } = await get(
      `${base}/api/history/sessions?projectId=${projectId}&personaId=${personaId}`,
    );
    assert.equal(body.totalItems, 1);
    assert.equal(body.items[0].id, launcherSessionId);
  });
});

describe('GET /api/history/sessions/:id', () => {
  it('returns the detail with latest summary and observations array', async () => {
    const { status, body } = await get(`${base}/api/history/sessions/${launcherSessionId}`);
    assert.equal(status, 200);
    assert.equal(body.id, launcherSessionId);
    assert.equal(body.personaLabel, 'Eng');
    assert.equal(body.projectName, 'HS');
    assert.equal(body.summaryCompleted, 'did the thing');
    assert.ok(Array.isArray(body.observations));
  });

  it('404s for unknown id', async () => {
    const { status } = await get(`${base}/api/history/sessions/999999`);
    assert.equal(status, 404);
  });
});
