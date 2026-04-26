import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

import { pasteRoutes } from '../../src/api/routes/paste.js';

// 1×1 transparent PNG
const PNG_1x1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

let dataDir;
beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paste-')); });
afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

async function startApp() {
  // Fastify's default 1MB body cap fires before our 10MB check; bump it
  // so the route's own size logic is what triggers.
  const app = Fastify({ bodyLimit: 32 * 1024 * 1024 });
  await app.register(pasteRoutes({ dataDir }), { prefix: '/api/paste' });
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

async function post(app, p, body) {
  const port = app.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /api/paste/image', () => {
  it('writes a PNG to ~/.agent-office/paste/<uuid>.png and returns its absolute path', async () => {
    const app = await startApp();
    try {
      const { status, body } = await post(app, '/api/paste/image', { mime: 'image/png', dataBase64: PNG_1x1_B64 });
      assert.equal(status, 200);
      assert.ok(body.data.path.endsWith('.png'));
      assert.ok(body.data.path.startsWith(path.join(dataDir, 'paste')));
      assert.ok(fs.existsSync(body.data.path));
      const bytes = fs.statSync(body.data.path).size;
      assert.equal(bytes, body.data.bytes);
      assert.ok(bytes > 0);
    } finally { await app.close(); }
  });

  it('rejects unsupported mime types with 400', async () => {
    const app = await startApp();
    try {
      const { status, body } = await post(app, '/api/paste/image', { mime: 'application/pdf', dataBase64: 'aGVsbG8=' });
      assert.equal(status, 400);
      assert.match(body.error, /unsupported mime type/);
    } finally { await app.close(); }
  });

  it('rejects payloads exceeding 10MB with 413', async () => {
    const app = await startApp();
    try {
      // 12 MB of zeros, base64-encoded.
      const big = Buffer.alloc(12 * 1024 * 1024).toString('base64');
      const { status, body } = await post(app, '/api/paste/image', { mime: 'image/png', dataBase64: big });
      assert.equal(status, 413);
      assert.match(body.error, /too large/);
    } finally { await app.close(); }
  });

  it('rejects empty / missing dataBase64 with 400', async () => {
    const app = await startApp();
    try {
      const { status } = await post(app, '/api/paste/image', { mime: 'image/png' });
      assert.equal(status, 400);
    } finally { await app.close(); }
  });

  it('uses unique filenames so concurrent pastes don\'t collide', async () => {
    const app = await startApp();
    try {
      const r1 = await post(app, '/api/paste/image', { mime: 'image/png', dataBase64: PNG_1x1_B64 });
      const r2 = await post(app, '/api/paste/image', { mime: 'image/png', dataBase64: PNG_1x1_B64 });
      assert.notEqual(r1.body.data.path, r2.body.data.path);
    } finally { await app.close(); }
  });
});
