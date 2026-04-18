// Persistence for observation embeddings: upsert into the sqlite-vec virtual
// table and track metadata (model + dims + content hash) in
// observation_embedding_meta.
//
// Kept separate from the embedding provider so tests can swap in a stub
// vector without hitting the HF model.

import { vecToBlob } from './embeddings.js';

/**
 * Concatenate the textual fields of an observation into the string we actually
 * embed. Keep it stable: the benchmark compares like-for-like.
 */
export function observationToText(obs) {
  const parts = [];
  if (obs.title) parts.push(obs.title);
  if (obs.subtitle) parts.push(obs.subtitle);
  if (obs.narrative) parts.push(obs.narrative);
  if (obs.facts) parts.push(typeof obs.facts === 'string' ? obs.facts : JSON.stringify(obs.facts));
  if (obs.concepts) {
    parts.push(typeof obs.concepts === 'string' ? obs.concepts : JSON.stringify(obs.concepts));
  }
  return parts.join('\n').trim();
}

/**
 * Upsert an embedding for a single observation. Safe to call repeatedly;
 * re-embed only if content_hash changed or a different model is configured.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} observationId
 * @param {Float32Array} vector
 * @param {{model: string, dims: number, contentHash?: string}} meta
 */
export function upsertEmbedding(db, observationId, vector, meta) {
  const blob = vecToBlob(vector);

  const txn = db.transaction(() => {
    db.prepare('DELETE FROM vec_observation WHERE rowid = ?').run(BigInt(observationId));
    db.prepare('INSERT INTO vec_observation (rowid, embedding) VALUES (?, ?)').run(
      BigInt(observationId),
      blob,
    );
    db.prepare(
      `INSERT INTO observation_embedding_meta
         (history_observation_id, model, dims, embedded_at, content_hash)
       VALUES (?, ?, ?, datetime('now'), ?)
       ON CONFLICT(history_observation_id) DO UPDATE SET
         model = excluded.model,
         dims = excluded.dims,
         embedded_at = excluded.embedded_at,
         content_hash = excluded.content_hash`,
    ).run(observationId, meta.model, meta.dims, meta.contentHash ?? null);
  });

  txn();
}

/**
 * Fetch observations that have no embedding yet (or whose embedding is stale
 * because the content_hash changed).
 */
export function listUnembeddedObservations(db, { model, limit = 500 } = {}) {
  return db.prepare(`
    SELECT obs.*
    FROM history_observation obs
    LEFT JOIN observation_embedding_meta meta
      ON meta.history_observation_id = obs.history_observation_id
    WHERE meta.history_observation_id IS NULL
       OR meta.model != ?
       OR (obs.content_hash IS NOT NULL AND meta.content_hash IS NOT NULL
           AND obs.content_hash != meta.content_hash)
    ORDER BY obs.created_at_epoch DESC
    LIMIT ?
  `).all(model, limit);
}

/**
 * Run a nearest-neighbour query over vec_observation, optionally filtered by
 * project and/or persona (persona filter requires a join on history_session).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Float32Array} query
 * @param {{k?: number, projectId?: number, personaId?: number|null}} opts
 * @returns {Array<{observationId: number, distance: number}>}
 */
export function searchSimilar(db, query, { k = 20, projectId, personaId } = {}) {
  const blob = vecToBlob(query);

  // Broaden the ANN search so the post-filter has candidates to choose from
  // when a project/persona filter is active.
  const annK = Math.max(k * 5, 50);

  const rows = db.prepare(`
    SELECT rowid AS observationId, distance
    FROM vec_observation
    WHERE embedding MATCH ? AND k = ?
    ORDER BY distance
  `).all(blob, annK);

  if (projectId == null && personaId == null) return rows.slice(0, k);

  // Post-filter by project and/or persona via join.
  const obsIds = rows.map((r) => r.observationId);
  if (obsIds.length === 0) return [];

  const placeholders = obsIds.map(() => '?').join(',');
  const filters = [];
  const params = [...obsIds];
  if (projectId != null) {
    filters.push('obs.project_id = ?');
    params.push(projectId);
  }
  if (personaId != null) {
    filters.push('sess.persona_id = ?');
    params.push(personaId);
  }

  const matched = db.prepare(`
    SELECT obs.history_observation_id AS observationId
    FROM history_observation obs
    JOIN history_session sess ON sess.history_session_id = obs.history_session_id
    WHERE obs.history_observation_id IN (${placeholders})
      AND ${filters.join(' AND ')}
  `).all(...params);

  const keepSet = new Set(matched.map((r) => r.observationId));
  return rows.filter((r) => keepSet.has(r.observationId)).slice(0, k);
}
