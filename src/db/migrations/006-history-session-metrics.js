export const version = 6;

/**
 * Sibling 1:1 metrics table for history_session. Keeps the core identity row
 * lean and provider-neutral while letting telemetry (tokens, cost, commits,
 * diff, outcome) live in a dedicated, evolvable surface.
 *
 * Backfill joins legacy `session` to `history_session` on provider keys so
 * every row that already had telemetry in the old table gets mirrored.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS history_session_metrics (
      history_session_id  INTEGER PRIMARY KEY
        REFERENCES history_session(history_session_id) ON DELETE CASCADE,
      tokens_in           INTEGER NOT NULL DEFAULT 0,
      tokens_out          INTEGER NOT NULL DEFAULT 0,
      tokens_cache_read   INTEGER NOT NULL DEFAULT 0,
      tokens_cache_write  INTEGER NOT NULL DEFAULT 0,
      cost_usd            REAL,
      commits_produced    INTEGER NOT NULL DEFAULT 0,
      diff_exists         INTEGER,
      outcome             TEXT,
      error               TEXT,
      last_model          TEXT,
      recorded_at         TEXT NOT NULL
    );
  `);

  // Backfill from legacy session table where a paired history_session exists.
  db.exec(`
    INSERT OR IGNORE INTO history_session_metrics (
      history_session_id,
      tokens_in, tokens_out, tokens_cache_read, tokens_cache_write,
      cost_usd, commits_produced, diff_exists, outcome, error,
      last_model, recorded_at
    )
    SELECT
      hs.history_session_id,
      COALESCE(s.tokens_in, 0),
      COALESCE(s.tokens_out, 0),
      COALESCE(s.tokens_cache_read, 0),
      COALESCE(s.tokens_cache_write, 0),
      s.cost_usd,
      COALESCE(s.commits_produced, 0),
      s.diff_exists,
      s.outcome,
      s.error,
      s.last_model,
      COALESCE(s.ended_at, s.started_at, hs.updated_at, hs.created_at)
    FROM history_session hs
    JOIN session s
      ON s.provider_id = hs.provider_id
     AND s.provider_session_id = hs.provider_session_id
    WHERE hs.provider_session_id IS NOT NULL;
  `);
}
