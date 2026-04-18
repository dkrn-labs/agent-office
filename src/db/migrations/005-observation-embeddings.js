export const version = 5;

/**
 * Adds a sqlite-vec virtual table for semantic search over history observations.
 *
 * Design:
 *   - 384-dim embeddings (matches all-MiniLM-L6-v2, the default embedding model).
 *   - rowid ↔ history_observation_id so we can join back cheaply.
 *   - A plain table tracks which observations have been embedded and with which
 *     model, so we can re-embed safely if the model changes.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_observation USING vec0(
      embedding float[384]
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS observation_embedding_meta (
      history_observation_id INTEGER PRIMARY KEY
        REFERENCES history_observation(history_observation_id) ON DELETE CASCADE,
      model         TEXT NOT NULL,
      dims          INTEGER NOT NULL,
      embedded_at   TEXT NOT NULL,
      content_hash  TEXT
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_obs_embed_model
      ON observation_embedding_meta(model);
  `);
}
