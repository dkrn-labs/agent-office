import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, get as httpGet } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createApp } from '../../src/api/server.js';
import { createRepository } from '../../src/db/repository.js';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { loadConfig } from '../../src/core/config.js';
import { createPersonaRegistry } from '../../src/agents/persona-registry.js';

// ── HTTP Helpers ──────────────────────────────────────────────────────────────

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

function post(url, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = httpRequest(options, (res) => {
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
    req.write(bodyStr);
    req.end();
  });
}

// ── Fixture setup ─────────────────────────────────────────────────────────────

let base;
let httpServer;
let repo;
let configDir;
let db;
let app;
let localSkillRoot;

before(async () => {
  configDir = mkdtempSync(join(tmpdir(), 'agent-office-office-test-'));
  localSkillRoot = join(configDir, 'skills');
  mkdirSync(join(localSkillRoot, 'react-auditor'), { recursive: true });
  writeFileSync(
    join(localSkillRoot, 'react-auditor', 'SKILL.md'),
    '# React Auditor\n\nChecks React component quality for UI projects.\n',
    'utf8',
  );

  db = openDatabase(':memory:');
  await runMigrations(db);

  repo = createRepository(db);
  const bus = createEventBus();
  const config = loadConfig(configDir);
  config.skillRoots = [localSkillRoot];

  // dryRun: true so launch doesn't try to spawn a terminal
  app = createApp({ repo, bus, config, configDir, db, dryRun: true });
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/personas', () => {
  before(async () => {
    // Seed built-in personas
    const registry = createPersonaRegistry(repo);
    await registry.seedBuiltIns();
  });

  it('returns seeded personas', async () => {
    const { status, body } = await get(`${base}/api/personas`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'body should be an array');
    assert.ok(body.length > 0, 'expected at least one seeded persona');

    // Each entry should have the expected shape
    const first = body[0];
    assert.ok('id' in first, 'persona should have id');
    assert.ok('label' in first, 'persona should have label');
    assert.ok('domain' in first, 'persona should have domain');
  });
});

describe('GET /api/skills', () => {
  it('returns 200 with an array', async () => {
    const { status, body } = await get(`${base}/api/skills`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'body should be an array');
  });

  it('returns installed/resolved/recommended inventory when personaId and projectId are provided', async () => {
    const registry = createPersonaRegistry(repo);
    await registry.seedBuiltIns();
    const personas = repo.listPersonas();
    const personaId = personas[0].id;
    const projectId = repo.createProject({
      path: `/tmp/test-project-${randomUUID()}`,
      name: 'ReactInventoryProject',
      techStack: ['react'],
    });

    const { status, body } = await get(`${base}/api/skills?personaId=${personaId}&projectId=${projectId}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.installed));
    assert.ok(Array.isArray(body.resolved));
    assert.ok(Array.isArray(body.recommended));
    assert.ok(body.installed.some((skill) => skill.name === 'React Auditor'));
  });
});

describe('POST /api/office/launch', () => {
  let personaId;
  let projectId;

  beforeEach(async () => {
    // Ensure a fresh persona and project exist for each launch test
    const registry = createPersonaRegistry(repo);
    await registry.seedBuiltIns();

    const personas = repo.listPersonas();
    assert.ok(personas.length > 0, 'need at least one persona');
    personaId = personas[0].id;

    const uid = randomUUID();
    projectId = repo.createProject({
      path: `/tmp/test-project-${uid}`,
      name: `TestProject-${uid}`,
    });
  });

  it('returns { sessionId } for valid personaId + projectId', async () => {
    const { status, body } = await post(`${base}/api/office/launch`, {
      personaId,
      projectId,
      providerId: 'gemini-cli',
      model: 'gemini-2.5-flash',
    });
    assert.equal(status, 200);
    assert.ok('sessionId' in body, 'response should have sessionId');
    assert.equal(typeof body.sessionId, 'number');
    assert.ok(body.sessionId > 0, 'sessionId should be a positive integer');
    const session = repo.getSession(body.sessionId);
    assert.equal(session.providerId, 'gemini-cli');
    assert.equal(session.lastModel, 'gemini-2.5-flash');
  });

  it('returns 400 when personaId is missing', async () => {
    const { status, body } = await post(`${base}/api/office/launch`, {
      projectId,
    });
    assert.equal(status, 400);
    assert.ok(body.error, 'should return an error message');
  });

  it('returns 400 when projectId is missing', async () => {
    const { status, body } = await post(`${base}/api/office/launch`, {
      personaId,
    });
    assert.equal(status, 400);
    assert.ok(body.error, 'should return an error message');
  });

  it('returns 404 for non-existent persona', async () => {
    const { status, body } = await post(`${base}/api/office/launch`, {
      personaId: 999999,
      projectId,
    });
    assert.equal(status, 404);
    assert.ok(body.error, 'should return an error message');
  });

  it('returns 404 for non-existent project', async () => {
    const { status, body } = await post(`${base}/api/office/launch`, {
      personaId,
      projectId: 999999,
    });
    assert.equal(status, 404);
    assert.ok(body.error, 'should return an error message');
  });
});
