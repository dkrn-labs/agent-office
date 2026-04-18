import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { upsertEmbedding, searchSimilar } from '../../src/memory/brief/embed-store.js';
import { estimateTokens, getPersonaBrief, getRawMemory } from '../../src/memory/brief/brief.js';

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'ao-brief-'));
  const db = openDatabase(join(dir, 'test.db'));
  return db;
}

async function seed(db) {
  await runMigrations(db);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  db.prepare(`INSERT INTO project (project_id, name, path) VALUES (1, 'proj-a', '/tmp/a')`).run();
  db.prepare(`INSERT INTO persona (persona_id, label, domain) VALUES (1, 'Frontend', 'frontend')`).run();
  db.prepare(`INSERT INTO persona (persona_id, label, domain) VALUES (2, 'Backend',  'backend')`).run();

  db.prepare(`INSERT INTO history_session (history_session_id, project_id, persona_id,
                provider_id, status, source, created_at, updated_at)
              VALUES (1, 1, 1, 'claude-code', 'completed', 'test', ?, ?)`).run(nowIso, nowIso);
  db.prepare(`INSERT INTO history_session (history_session_id, project_id, persona_id,
                provider_id, status, source, created_at, updated_at)
              VALUES (2, 1, 2, 'claude-code', 'completed', 'test', ?, ?)`).run(nowIso, nowIso);

  const insertObs = db.prepare(`
    INSERT INTO history_observation (history_session_id, project_id, provider_id,
      type, title, narrative, created_at, created_at_epoch)
    VALUES (?, 1, 'claude-code', 'summary', ?, ?, ?, ?)
  `);

  // Frontend persona observations.
  insertObs.run(1, 'Fixed CSS grid bug',
    'The two-column layout collapsed on narrow screens; fixed via minmax().', nowIso, now - 60000);
  insertObs.run(1, 'Reworked login form',
    'Added validation and ARIA labels; matches design spec.', nowIso, now - 50000);
  // Backend persona observations.
  insertObs.run(2, 'Redis connection pool',
    'Increased max connections; resolved p95 latency spike on /auth endpoint.', nowIso, now - 40000);
  insertObs.run(2, 'Database migration 007',
    'Added index on users.email; query went from 1.2s to 12ms.', nowIso, now - 30000);
}

test('getRawMemory filters by project and persona', async () => {
  const db = makeDb();
  await seed(db);

  const allA = getRawMemory(db, { projectId: 1 });
  assert.match(allA, /CSS grid/);
  assert.match(allA, /Redis/);

  const feOnly = getRawMemory(db, { projectId: 1, personaId: 1 });
  assert.match(feOnly, /CSS grid/);
  assert.doesNotMatch(feOnly, /Redis/);

  db.close();
});

test('getPersonaBrief stays under budget and includes recent observations', async () => {
  const db = makeDb();
  await seed(db);

  const brief = await getPersonaBrief(db, {
    projectId: 1,
    personaId: 2,
    budgetTokens: 300,
  });

  assert.ok(brief.usedTokens <= 300, `brief ${brief.usedTokens}t > 300t budget`);
  assert.match(brief.markdown, /Redis|migration/, 'brief should include backend observations');
  assert.doesNotMatch(brief.markdown, /CSS grid/, 'brief should not leak frontend observations');
  assert.ok(brief.sourceCount >= 1, 'brief should select at least one observation');

  db.close();
});

test('embed-store upsert + similarity search round-trip', async () => {
  const db = makeDb();
  await seed(db);

  // Construct two orthogonal fake vectors.
  const dims = 384;
  const a = new Float32Array(dims); a[0] = 1;
  const b = new Float32Array(dims); b[1] = 1;

  upsertEmbedding(db, 1, a, { model: 'test', dims });
  upsertEmbedding(db, 2, b, { model: 'test', dims });

  const hits = searchSimilar(db, a, { k: 2, projectId: 1 });
  assert.equal(hits[0].observationId, 1, 'closest match should be the vector we queried');

  db.close();
});

test('estimateTokens is stable for regression tracking', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('a'.repeat(100)), 25);
});
