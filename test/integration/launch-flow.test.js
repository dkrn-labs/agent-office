import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import http from 'node:http';

const CLI = new URL('../../bin/agent-office.js', import.meta.url).pathname;

/**
 * Makes a GET request and returns { statusCode, body } (body parsed as JSON).
 * @param {string} url
 * @returns {Promise<{ statusCode: number, body: unknown }>}
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch { body = raw; }
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => { req.destroy(new Error('timeout')); });
  });
}

/**
 * Makes a POST request with a JSON body and returns { statusCode, body }.
 * @param {string} url
 * @param {unknown} data
 * @returns {Promise<{ statusCode: number, body: unknown }>}
 */
function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch { body = raw; }
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

/**
 * Retries GET /api/health until it returns HTTP 200, up to maxAttempts times
 * with delayMs between each attempt.
 * @param {string} baseUrl
 * @param {{ maxAttempts?: number, delayMs?: number }} opts
 * @returns {Promise<void>}
 */
async function waitForServer(baseUrl, { maxAttempts = 20, delayMs = 300 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { statusCode } = await httpGet(`${baseUrl}/api/health`);
      if (statusCode === 200) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Server at ${baseUrl} did not become ready after ${maxAttempts} attempts`);
}

describe('agent-office full persona launch flow', () => {
  let tmpDir;
  let dataDir;
  let projectsDir;
  let serverProcess;
  let port;
  let baseUrl;

  before(async () => {
    // ── 1. Create tmp dir with a fake git repo containing package.json ─────────
    tmpDir = mkdtempSync(join(os.tmpdir(), 'ao-launch-flow-'));
    dataDir = join(tmpDir, '.agent-office');
    projectsDir = join(tmpDir, 'projects');

    const repoDir = join(projectsDir, 'my-react-app');
    mkdirSync(join(repoDir, '.git'), { recursive: true });
    writeFileSync(
      join(repoDir, 'package.json'),
      JSON.stringify({
        name: 'my-react-app',
        version: '1.0.0',
        dependencies: { react: '^18.0.0' },
      }),
    );

    // ── 2. Run init ────────────────────────────────────────────────────────────
    await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [
        CLI, 'init',
        '--data-dir', dataDir,
        '--projects-dir', projectsDir,
      ], { stdio: 'pipe' });

      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`init exited with code ${code}`));
      });
    });

    // ── 3. Pick a random high port and spawn start ─────────────────────────────
    port = 41000 + Math.floor(Math.random() * 10000);
    baseUrl = `http://127.0.0.1:${port}`;

    serverProcess = spawn(process.execPath, [
      CLI, 'start',
      '--data-dir', dataDir,
      '--port', String(port),
    ], { stdio: 'pipe' });

    serverProcess.on('error', (err) => {
      throw new Error(`Failed to spawn server: ${err.message}`);
    });

    // ── 4. Wait for server ready ───────────────────────────────────────────────
    await waitForServer(baseUrl);
  });

  after(() => {
    // ── Kill server ────────────────────────────────────────────────────────────
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Tests ──────────────────────────────────────────────────────────────────

  it('GET /api/personas returns 5 personas', async () => {
    const { statusCode, body } = await httpGet(`${baseUrl}/api/personas`);
    assert.equal(statusCode, 200);
    assert.ok(Array.isArray(body), 'body should be an array');
    assert.equal(body.length, 5, `expected 5 personas, got ${body.length}`);
  });

  it('GET /api/projects returns the discovered project', async () => {
    const { statusCode, body } = await httpGet(`${baseUrl}/api/projects`);
    assert.equal(statusCode, 200);
    assert.ok(Array.isArray(body), 'body should be an array');

    const project = body.find((p) => p.name === 'my-react-app');
    assert.ok(project, 'my-react-app project not found in /api/projects');
  });

  it('GET /api/skills returns at least 10 skills', async () => {
    const { statusCode, body } = await httpGet(`${baseUrl}/api/skills`);
    assert.equal(statusCode, 200);
    assert.ok(Array.isArray(body), 'body should be an array');
    assert.ok(body.length >= 10, `expected at least 10 skills, got ${body.length}`);
  });

  it('POST /api/office/launch with first persona + first project returns { sessionId }', async () => {
    // Fetch personas and projects to get real IDs
    const { body: personas } = await httpGet(`${baseUrl}/api/personas`);
    const { body: projects } = await httpGet(`${baseUrl}/api/projects`);

    assert.ok(Array.isArray(personas) && personas.length > 0, 'no personas available');
    assert.ok(Array.isArray(projects) && projects.length > 0, 'no projects available');

    const personaId = personas[0].id;
    const projectId = projects[0].id;

    const { statusCode, body } = await httpPost(`${baseUrl}/api/office/launch`, {
      personaId,
      projectId,
    });

    assert.equal(statusCode, 200, `expected 200, got ${statusCode}: ${JSON.stringify(body)}`);
    assert.ok(body != null && typeof body === 'object', 'body should be an object');
    assert.ok('sessionId' in body, `response should have sessionId, got: ${JSON.stringify(body)}`);
    assert.ok(
      typeof body.sessionId === 'number' && body.sessionId > 0,
      `sessionId should be a positive number, got: ${body.sessionId}`,
    );
  });
});
