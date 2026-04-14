import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { get as httpGet } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createApp } from '../../src/api/server.js';
import { createRepository } from '../../src/db/repository.js';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { loadConfig } from '../../src/core/config.js';
import { createPersonaRegistry } from '../../src/agents/persona-registry.js';

// ── HTTP Helper ───────────────────────────────────────────────────────────────

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

// ── Fixture setup ─────────────────────────────────────────────────────────────

let base;
let httpServer;
let repo;
let configDir;
let db;

before(async () => {
  configDir = mkdtempSync(join(tmpdir(), 'agent-office-preview-test-'));

  db = openDatabase(':memory:');
  await runMigrations(db);

  repo = createRepository(db);
  const bus = createEventBus();
  const config = loadConfig(configDir);

  // dryRun: true so launch doesn't try to spawn a terminal
  const app = createApp({ repo, bus, config, configDir, db, dryRun: true });
  httpServer = createServer(app);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  return new Promise((resolve, reject) => {
    httpServer.close((err) => {
      rmSync(configDir, { recursive: true, force: true });
      if (err) reject(err);
      else resolve();
    });
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/office/preview', () => {
  let personaId;
  let projectId;

  beforeEach(async () => {
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

  it('returns 400 when personaId is missing', async () => {
    const { status } = await get(`${base}/api/office/preview?projectId=${projectId}`);
    assert.equal(status, 400);
  });

  it('returns 400 when projectId is missing', async () => {
    const { status } = await get(`${base}/api/office/preview?personaId=${personaId}`);
    assert.equal(status, 400);
  });

  it('returns 404 for unknown persona', async () => {
    const { status } = await get(`${base}/api/office/preview?personaId=999999&projectId=${projectId}`);
    assert.equal(status, 404);
  });

  it('returns preview context for valid ids', async () => {
    const { status, body: data } = await get(`${base}/api/office/preview?personaId=${personaId}&projectId=${projectId}`);
    assert.equal(status, 200);
    assert.equal(data.persona.id, personaId);
    assert.equal(data.project.id, projectId);
    assert.ok(Array.isArray(data.skills));
    assert.ok(Array.isArray(data.memories));
    assert.ok(Array.isArray(data.personaObservations));
    assert.ok('lastSession' in data);
  });
});
