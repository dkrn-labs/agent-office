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

let base;
let httpServer;
let repo;
let configDir;
let app;
let projectId;

before(async () => {
  configDir = mkdtempSync(join(tmpdir(), 'agent-office-history-test-'));
  const db = openDatabase(':memory:');
  await runMigrations(db);

  repo = createRepository(db);
  projectId = Number(repo.createProject({ path: '/test/history-api', name: 'History API' }));
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

describe('POST /api/history/ingest', () => {
  it('persists a provider-neutral summary and observations by project path', async () => {
    const { status, body } = await post(`${base}/api/history/ingest`, {
      projectPath: '/test/history-api',
      providerId: 'gemini-cli',
      providerSessionId: 'gemini-session-1',
      model: 'gemini-2.5-flash',
      summary: {
        completed: 'Implemented project history ingestion.',
        nextSteps: 'Wire CLI hooks.',
        filesEdited: ['src/api/routes/history.js'],
      },
      observations: [
        {
          type: 'feature',
          title: 'Added history ingestion route',
          filesModified: ['src/api/routes/history.js'],
        },
      ],
    });

    assert.equal(status, 200);
    assert.equal(body.error, null);
    assert.equal(body.data.projectId, projectId);
    assert.equal(body.data.observationCount, 1);
  });
});

describe('GET /api/projects/:projectId/history', () => {
  it('returns stored summaries and observations in a consistent envelope', async () => {
    const { status, body } = await get(`${base}/api/projects/${projectId}/history`);
    assert.equal(status, 200);
    assert.equal(body.error, null);
    assert.equal(body.meta.projectId, projectId);
    assert.equal(body.data.summaries.length, 1);
    assert.equal(body.data.observations.length, 1);
    assert.equal(body.data.summaries[0].completed, 'Implemented project history ingestion.');
    assert.equal(body.data.observations[0].title, 'Added history ingestion route');
  });
});
