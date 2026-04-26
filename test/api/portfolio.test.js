import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { get as httpGet } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { createApp } from '../../src/api/server.js';
import { createRepository } from '../../src/db/repository.js';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { loadConfig } from '../../src/core/config.js';

function git(cwd, args, env = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...env,
    },
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
  });
}

let base;
let httpServer;
let app;
let configDir;

before(async () => {
  configDir = mkdtempSync(join(tmpdir(), 'agent-office-portfolio-api-'));
  const projectsDir = join(configDir, 'Projects');
  const repoDir = join(projectsDir, 'repo-a');
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, ['init']);
  writeFileSync(join(repoDir, 'a.txt'), 'hello\n', 'utf8');
  git(repoDir, ['add', '.']);
  // Time-relative windows (today / 7d / 30d) need time-relative fixtures —
  // see issue #0001. Anchor every commit and session timestamp to "now"
  // minus a small offset so they always fall inside the asserted window.
  const commitIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();      // 1h ago
  const sessionStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();   // 30m ago
  const sessionEnd   = new Date(Date.now() - 20 * 60 * 1000).toISOString();   // 20m ago
  git(repoDir, ['commit', '-m', 'init'], {
    GIT_AUTHOR_DATE: commitIso,
    GIT_COMMITTER_DATE: commitIso,
  });

  const db = openDatabase(':memory:');
  await runMigrations(db);
  const repo = createRepository(db);
  const projectId = Number(repo.createProject({ path: repoDir, name: 'repo-a' }));
  const personaId = Number(repo.createPersona({
    label: 'Backend',
    domain: 'backend',
    secondaryDomains: [],
    skillIds: [],
    source: 'test',
  }));
  const sessionId = repo.createSession({
    projectId,
    personaId,
    startedAt: sessionStart,
    systemPrompt: 'prompt',
  });
  repo.updateSession(sessionId, {
    endedAt: sessionEnd,
    tokensIn: 300_000,
    tokensOut: 200_000,
    commitsProduced: 1,
  });
  // portfolio-stats.js counts via repo.countHistorySessionsSince — legacy
  // `session` rows don't show up. Mirror this session into history_session
  // so today.sessionCount reflects what the operator actually sees.
  repo.createHistorySession({
    projectId,
    personaId,
    providerId: 'claude-code',
    providerSessionId: 'pf-api-test-a',
    startedAt: sessionStart,
    endedAt: sessionEnd,
    status: 'completed',
    source: 'launcher',
  });

  const bus = createEventBus();
  const config = loadConfig(configDir);
  config.projectsDir = projectsDir;
  app = createApp({ repo, bus, config, configDir, telemetry: false });
  await app.ready();
  httpServer = app.server;
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

describe('GET /api/portfolio/stats', () => {
  it('returns today/7d/30d snapshots', async () => {
    const { status, body } = await get(`${base}/api/portfolio/stats`);
    assert.equal(status, 200);
    assert.ok(body.today);
    assert.ok(body['7d']);
    assert.ok(body['30d']);
    assert.equal(body.today.repoCount, 1);
    assert.equal(body.today.sessionCount, 1);
  });
});
