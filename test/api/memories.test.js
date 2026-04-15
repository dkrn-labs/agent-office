import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request as httpRequest, get as httpGet } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/api/server.js';
import { createRepository } from '../../src/db/repository.js';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { loadConfig } from '../../src/core/config.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
let projectId;
let app;

before(async () => {
  configDir = mkdtempSync(join(tmpdir(), 'agent-office-memories-test-'));

  const db = openDatabase(':memory:');
  await runMigrations(db);

  repo = createRepository(db);
  const bus = createEventBus();
  const config = loadConfig(configDir);

  // Create a project to use in tests
  projectId = repo.createProject({ path: '/test/mem-project', name: 'MemProject' });

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/projects/:id/memories', () => {
  it('returns empty array initially', async () => {
    const { status, body } = await get(`${base}/api/projects/${projectId}/memories`);
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });
});

describe('POST /api/projects/:id/memories', () => {
  it('creates a memory and returns memoryId', async () => {
    const { status, body } = await post(`${base}/api/projects/${projectId}/memories`, {
      domain: 'backend',
      type: 'convention',
      content: 'Always use ESM imports with .js extensions.',
    });
    assert.equal(status, 201);
    assert.equal(typeof body.memoryId, 'number');
    assert.ok(body.memoryId > 0, 'memoryId should be a positive integer');
  });
});

describe('GET /api/projects/:id/memories (after create)', () => {
  it('returns the created memory', async () => {
    const { status, body } = await get(`${base}/api/projects/${projectId}/memories`);
    assert.equal(status, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].domain, 'backend');
    assert.equal(body[0].type, 'convention');
    assert.equal(body[0].content, 'Always use ESM imports with .js extensions.');
    assert.equal(body[0].projectId, projectId);
  });
});

describe('GET /api/projects/:id/memories/stats', () => {
  it('returns { total: 1, active: 1, stale: 0, archived: 0 }', async () => {
    const { status, body } = await get(`${base}/api/projects/${projectId}/memories/stats`);
    assert.equal(status, 200);
    assert.deepEqual(body, { total: 1, active: 1, stale: 0, archived: 0 });
  });
});
