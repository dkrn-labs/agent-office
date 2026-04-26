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
 * Retries GET /api/_health until it returns HTTP 200, up to maxAttempts times
 * with delayMs between each attempt.
 * @param {string} baseUrl
 * @param {{ maxAttempts?: number, delayMs?: number }} opts
 * @returns {Promise<void>}
 */
async function waitForServer(baseUrl, { maxAttempts = 10, delayMs = 200 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { statusCode } = await httpGet(`${baseUrl}/api/_health`);
      if (statusCode === 200) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Server at ${baseUrl} did not become ready after ${maxAttempts} attempts`);
}

describe('agent-office init + start integration', () => {
  let tmpDir;
  let dataDir;
  let projectsDir;
  let serverProcess;
  let port;
  let baseUrl;

  before(async () => {
    // ── 1. Create tmp dir with a fake git repo inside ────────────────────────
    tmpDir = mkdtempSync(join(os.tmpdir(), 'ao-integration-'));
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

    // ── 2. Run init ──────────────────────────────────────────────────────────
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

    // ── 3. Pick a random high port and spawn start ───────────────────────────
    port = 40000 + Math.floor(Math.random() * 10000);
    baseUrl = `http://127.0.0.1:${port}`;

    serverProcess = spawn(process.execPath, [
      CLI, 'start',
      '--data-dir', dataDir,
      '--port', String(port),
    ], { stdio: 'pipe' });

    serverProcess.on('error', (err) => {
      throw new Error(`Failed to spawn server: ${err.message}`);
    });

    // ── 4. Wait for server ready ─────────────────────────────────────────────
    await waitForServer(baseUrl);
  });

  after(() => {
    // ── 6. Kill server ───────────────────────────────────────────────────────
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 5. Assertions ──────────────────────────────────────────────────────────

  it('GET /api/_health returns { status: "ok" }', async () => {
    const { statusCode, body } = await httpGet(`${baseUrl}/api/_health`);
    assert.equal(statusCode, 200);
    assert.equal(body.data.status, 'ok');
  });

  it('GET /api/projects returns the discovered repo with correct name', async () => {
    const { statusCode, body } = await httpGet(`${baseUrl}/api/projects`);
    assert.equal(statusCode, 200);
    assert.ok(Array.isArray(body), 'body should be an array');

    const project = body.find((p) => p.name === 'my-react-app');
    assert.ok(project, 'my-react-app project not found in /api/projects');
  });

  it('discovered project has tech_stack including "node" and "react"', async () => {
    const { statusCode, body } = await httpGet(`${baseUrl}/api/projects`);
    assert.equal(statusCode, 200);

    const project = body.find((p) => p.name === 'my-react-app');
    assert.ok(project, 'my-react-app project not found');

    const stack = project.techStack ?? project.tech_stack ?? [];
    assert.ok(
      stack.includes('node'),
      `expected tech_stack to include "node", got: ${JSON.stringify(stack)}`,
    );
    assert.ok(
      stack.includes('react'),
      `expected tech_stack to include "react", got: ${JSON.stringify(stack)}`,
    );
  });

  it('refreshes projects after a new repo is added post-startup', async () => {
    const repoDir = join(projectsDir, 'late-added-app');
    mkdirSync(join(repoDir, '.git'), { recursive: true });
    writeFileSync(
      join(repoDir, 'package.json'),
      JSON.stringify({
        name: 'late-added-app',
        version: '1.0.0',
        dependencies: { express: '^5.0.0' },
      }),
    );

    const { statusCode, body } = await httpGet(`${baseUrl}/api/projects`);
    assert.equal(statusCode, 200);
    assert.ok(Array.isArray(body), 'body should be an array');

    const project = body.find((p) => p.name === 'late-added-app');
    assert.ok(project, 'late-added-app project not found in /api/projects');
    assert.equal(project.path, repoDir);
  });
});
