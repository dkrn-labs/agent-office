export const version = 7;

/**
 * launch_budget — every launch persists what the *naive baseline* (full
 * skills + all observations + full memory dump) would have cost in tokens
 * vs what the *optimized* path (persona-filtered, capped) actually loaded.
 *
 * Drives the savings pill. Outcome-weighted: rows with outcome='rejected'
 * never count as savings (set in P1-6 / P5-2).
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS launch_budget (
      history_session_id  INTEGER PRIMARY KEY
        REFERENCES history_session(history_session_id) ON DELETE CASCADE,
      provider_id            TEXT NOT NULL,
      model                  TEXT,
      baseline_tokens        INTEGER NOT NULL,
      optimized_tokens       INTEGER NOT NULL,
      baseline_breakdown     TEXT,        -- JSON: {persona,skills,history,memory}
      optimized_breakdown    TEXT,        -- JSON: same shape
      outcome                TEXT,        -- 'accepted'|'partial'|'rejected'|null (set at session end)
      cost_dollars           REAL,
      cloud_equivalent_dollars REAL,
      created_at_epoch       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_launch_budget_created
      ON launch_budget(created_at_epoch DESC);

    CREATE INDEX IF NOT EXISTS idx_launch_budget_outcome
      ON launch_budget(outcome);
  `);
}
