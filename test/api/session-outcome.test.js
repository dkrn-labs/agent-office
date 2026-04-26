import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { sessionOutcomeRoutes } from '../../src/api/routes/session-outcome.js';

let dbDir, db, repo, app, busEvents;

beforeEach(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-'));
  db = openDatabase(path.join(dbDir, 'test.db'));
  await runMigrations(db);
  repo = createRepository(db);
  // Seed a project + history_session so the FK has something to land on.
  const projId = repo.createProject({ name: 'p', path: '/p' });
  // history_session insertion is via the lower-level helper used by the watcher.
  db.prepare(`
    INSERT INTO history_session (project_id, provider_id, started_at, ended_at, status, source, created_at, updated_at)
    VALUES (?, 'claude-code', '2026-04-26T10:00:00Z', '2026-04-26T10:30:00Z', 'completed', 'test', '2026-04-26T10:00:00Z', '2026-04-26T10:30:00Z')
  `).run(projId);

  busEvents = [];
  const bus = { emit: (name, payload) => busEvents.push({ name, payload }) };

  app = Fastify();
  await app.register(sessionOutcomeRoutes({ repo, bus }), { prefix: '/api/sessions' });
  await app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

async function postOutcome(id, body) {
  const port = app.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions/${id}/outcome`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /api/sessions/:id/outcome', () => {
  it('writes outcome + outcome_source=operator and emits the bus event', async () => {
    const { status, body } = await postOutcome(1, { outcome: 'accepted' });
    assert.equal(status, 200);
    assert.equal(body.data.outcome, 'accepted');
    assert.equal(body.data.source, 'operator');
    assert.equal(repo.getHistorySessionOutcomeSource(1), 'operator');
    const metrics = repo.getHistorySessionMetrics(1);
    assert.equal(metrics.outcome, 'accepted');
    assert.equal(busEvents.length, 1);
    assert.equal(busEvents[0].name, 'session:outcome:updated');
  });

  it('rejects unknown outcome with 400', async () => {
    const { status, body } = await postOutcome(1, { outcome: 'great' });
    assert.equal(status, 400);
    assert.match(body.error, /outcome must be one of/);
  });

  it('rejects missing outcome with 400', async () => {
    const { status } = await postOutcome(1, {});
    assert.equal(status, 400);
  });

  it('rejects bogus session id with 400', async () => {
    const { status } = await postOutcome('abc', { outcome: 'accepted' });
    assert.equal(status, 400);
  });

  it('updates an existing operator outcome on second call', async () => {
    await postOutcome(1, { outcome: 'partial' });
    await postOutcome(1, { outcome: 'rejected' });
    assert.equal(repo.getHistorySessionMetrics(1).outcome, 'rejected');
  });
});
