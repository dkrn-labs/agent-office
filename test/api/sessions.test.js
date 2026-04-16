import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { get as httpGet } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
let oldHome;
let sessionId;
let activeSessionId;
let app;

before(async () => {
  configDir = mkdtempSync(join(tmpdir(), 'agent-office-sessions-test-'));
  oldHome = process.env.HOME;
  process.env.HOME = configDir;

  const db = openDatabase(':memory:');
  await runMigrations(db);

  repo = createRepository(db);
  const projectId = Number(repo.createProject({ path: '/tmp/test-proj', name: 'test-proj' }));
  const personaId = Number(repo.createPersona({
    label: 'Frontend',
    domain: 'frontend',
    secondaryDomains: [],
    skillIds: [],
    source: 'test',
  }));
  sessionId = repo.createSession({
    projectId,
    personaId,
    startedAt: '2026-04-15T08:00:00.000Z',
    systemPrompt: 'prompt text',
  });
  repo.updateSession(sessionId, {
    endedAt: '2026-04-15T08:10:00.000Z',
    tokensIn: 1000,
    tokensOut: 500,
    costUsd: 1.5,
    outcome: 'accepted',
  });

  activeSessionId = repo.createSession({
    projectId,
    personaId,
    startedAt: '2026-04-15T09:00:00.000Z',
    systemPrompt: 'active prompt',
  });

  const bus = createEventBus();
  const config = loadConfig(configDir);
  app = createApp({
    repo,
    bus,
    config,
    configDir,
    telemetry: true,
    startTelemetryWatcher: false,
    telemetryIdleMs: 5000,
    telemetryExpiryMs: 5100,
  });

  app.locals.telemetry.watcher.registerLaunch({
    projectPath: '/tmp/test-proj',
    sessionId: activeSessionId,
    personaId,
    projectId,
    launchedAt: '2026-04-15T09:00:00.000Z',
  });
  app.locals.telemetry.watcher.ingestUsage('provider-active', '/tmp/test-proj', {
    providerSessionId: 'provider-active',
    cwd: '/tmp/test-proj',
    timestamp: '2026-04-15T09:01:00.000Z',
    model: 'claude-sonnet-4-6',
    tokensIn: 250,
    tokensOut: 125,
    cacheRead: 25,
    cacheWrite: 0,
  });

  httpServer = createServer(app);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  process.env.HOME = oldHome;
  app.locals.stopTelemetry?.();
  httpServer.closeAllConnections?.();
  return new Promise((resolve, reject) => {
    httpServer.close((err) => {
      rmSync(configDir, { recursive: true, force: true });
      if (err) reject(err);
      else resolve();
    });
  });
});

describe('GET /api/sessions', () => {
  it('returns paginated history', async () => {
    const { status, body } = await get(`${base}/api/sessions?page=1&pageSize=10`);
    assert.equal(status, 200);
    assert.equal(body.totalItems >= 1, true);
    assert.equal(body.items[0].projectName, 'test-proj');
  });
});

describe('GET /api/sessions/active', () => {
  it('returns live active sessions merged with telemetry totals', async () => {
    const { status, body } = await get(`${base}/api/sessions/active`);
    assert.equal(status, 200);
    assert.equal(Array.isArray(body), true);
    assert.equal(body.length, 1);
    assert.equal(body[0].sessionId, activeSessionId);
    assert.equal(body[0].providerSessionId, 'provider-active');
    assert.equal(body[0].projectName, 'test-proj');
    assert.equal(body[0].personaLabel, 'Frontend');
    assert.equal(body[0].totals.total, 400);
    assert.equal(body[0].totals.tokensIn, 250);
    assert.equal(body[0].totals.tokensOut, 125);
    assert.equal(body[0].working, true);
  });
});

describe('GET /api/sessions/:id', () => {
  it('returns a single session detail', async () => {
    const { status, body } = await get(`${base}/api/sessions/${sessionId}`);
    assert.equal(status, 200);
    assert.equal(body.id, sessionId);
    assert.equal(body.systemPrompt, 'prompt text');
  });
});

describe('GET /api/sessions/stats and /api/sessions/pulse', () => {
  it('returns stats and pulse payloads', async () => {
    const stats = await get(`${base}/api/sessions/stats`);
    const pulse = await get(`${base}/api/sessions/pulse`);
    assert.equal(stats.status, 200);
    assert.equal(typeof stats.body.sessionsToday, 'number');
    assert.equal(pulse.status, 200);
    assert.equal(Array.isArray(pulse.body), true);
    assert.equal(pulse.body.length, 6);
  });
});
