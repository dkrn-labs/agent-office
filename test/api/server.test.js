import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { get as httpGet, request as httpRequest } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/api/server.js';
import { createRepository } from '../../src/db/repository.js';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { loadConfig } from '../../src/core/config.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * HTTP GET → { status, body }
 * @param {string} url
 * @returns {Promise<{ status: number, body: any }>}
 */
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

/**
 * HTTP PUT with JSON body → { status, body }
 * @param {string} url
 * @param {object} payload
 * @returns {Promise<{ status: number, body: any }>}
 */
function put(url, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: parsed.pathname,
      method: 'PUT',
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
let projectsDir;
let app;

before(async () => {
  configDir = mkdtempSync(join(tmpdir(), 'agent-office-test-'));
  projectsDir = join(configDir, 'projects');
  mkdirSync(projectsDir, { recursive: true });

  // Use an in-memory SQLite database
  const db = openDatabase(':memory:');
  await runMigrations(db);

  repo = createRepository(db);
  const bus = createEventBus();
  const config = { ...loadConfig(configDir), projectsDir };

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

describe('GET /api/health', () => {
  it('returns status ok, uptime, and version', async () => {
    const { status, body } = await get(`${base}/api/health`);
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptime, 'number');
    assert.ok(body.uptime >= 0, 'uptime should be a non-negative number');
    assert.equal(typeof body.version, 'string');
    assert.ok(body.version.length > 0, 'version should be a non-empty string');
  });
});

describe('GET /api/projects', () => {
  it('returns empty array when no projects exist', async () => {
    const { status, body } = await get(`${base}/api/projects`);
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it('returns created projects', async () => {
    mkdirSync(join(projectsDir, 'Alpha', '.git'), { recursive: true });
    mkdirSync(join(projectsDir, 'Beta', '.git'), { recursive: true });
    repo.createProject({ path: '/test/alpha', name: 'Alpha' });
    repo.createProject({ path: '/test/beta', name: 'Beta' });
    const projects = repo.listProjects();
    const alpha = projects.find((p) => p.name === 'Alpha');
    const beta = projects.find((p) => p.name === 'Beta');
    assert.ok(alpha);
    assert.ok(beta);
    repo.updateProject(alpha.id, { path: join(projectsDir, 'Alpha') });
    repo.updateProject(beta.id, { path: join(projectsDir, 'Beta') });

    const { status, body } = await get(`${base}/api/projects`);
    assert.equal(status, 200);
    assert.equal(body.length, 2);

    const names = body.map((p) => p.name).sort();
    assert.deepEqual(names, ['Alpha', 'Beta']);
  });
});

describe('GET /api/projects/active', () => {
  it('filters to only active projects', async () => {
    const all = repo.listProjects();
    const alpha = all.find((p) => p.name === 'Alpha');
    assert.ok(alpha, 'Alpha project should exist from prior test');

    // Mark Alpha inactive and remove it from disk so the sync does not
    // reactivate it on the next list request.
    repo.updateProject(alpha.id, { active: false });
    rmSync(join(projectsDir, 'Alpha'), { recursive: true, force: true });

    const { status, body } = await get(`${base}/api/projects/active`);
    assert.equal(status, 200);

    const names = body.map((p) => p.name);
    assert.ok(!names.includes('Alpha'), 'Alpha should not appear in active list');
    assert.ok(names.includes('Beta'), 'Beta should appear in active list');

    // Restore for potential future tests
    repo.updateProject(alpha.id, { active: true });
  });
});

describe('GET /api/config', () => {
  it('returns current config with defaults', async () => {
    const { status, body } = await get(`${base}/api/config`);
    assert.equal(status, 200);
    assert.equal(typeof body.version, 'number');
    assert.equal(typeof body.port, 'number');
    assert.ok(body.garden != null, 'Expected garden sub-object');
    assert.ok('requireApproval' in body.garden, 'Expected requireApproval in garden');
  });
});

describe('PUT /api/config', () => {
  it('merges body into config, returns and persists the update', async () => {
    const { status, body: updated } = await put(`${base}/api/config`, {
      port: 9999,
      garden: { requireApproval: false },
    });
    assert.equal(status, 200);
    assert.equal(updated.port, 9999);
    assert.equal(updated.garden.requireApproval, false);
    // Other garden keys should survive the merge
    assert.ok('memorySchedule' in updated.garden, 'memorySchedule should be preserved');

    // Verify the change was actually written to disk
    const persisted = loadConfig(configDir);
    assert.equal(persisted.port, 9999);
    assert.equal(persisted.garden.requireApproval, false);
  });
});
