#!/usr/bin/env node
// Backfill: embed every history_observation that has no vector (or whose model
// tag is stale). Idempotent — safe to re-run after the model changes.

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { openDatabase, runMigrations } from '../src/db/database.js';
import { embedBatch } from '../src/memory/brief/embeddings.js';
import {
  listUnembeddedObservations,
  upsertEmbedding,
  observationToText,
} from '../src/memory/brief/embed-store.js';

const BATCH = 16;

const dbPath = process.env.AGENT_OFFICE_DB
  ?? resolve(homedir(), '.agent-office', 'agent-office.db');

console.log(`[backfill] opening ${dbPath}`);
const db = openDatabase(dbPath);
await runMigrations(db);

const { model, dims } = await probeModel();
console.log(`[backfill] embedding model: ${model} (${dims}-dim)`);

let total = 0;
while (true) {
  const rows = listUnembeddedObservations(db, { model, limit: BATCH });
  if (rows.length === 0) break;

  const texts = rows.map(observationToText);
  const { vectors } = await embedBatch(texts);
  for (let i = 0; i < rows.length; i++) {
    const obs = rows[i];
    upsertEmbedding(db, obs.history_observation_id, vectors[i], {
      model,
      dims,
      contentHash: obs.content_hash,
    });
  }
  total += rows.length;
  process.stdout.write(`  · embedded ${total}…\r`);
}

console.log(`\n[backfill] done — embedded ${total} observation(s)`);
db.close();

async function probeModel() {
  const { model, dims } = await embedBatch(['warmup']);
  return { model, dims };
}
