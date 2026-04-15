export const version = 3;

/**
 * Adds cached portfolio stats snapshots for right-rail analytics.
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_stats_snapshot (
      window_key       TEXT PRIMARY KEY,
      computed_at      TEXT NOT NULL,
      repo_count       INTEGER NOT NULL DEFAULT 0,
      commit_count     INTEGER NOT NULL DEFAULT 0,
      file_count       INTEGER NOT NULL DEFAULT 0,
      session_count    INTEGER NOT NULL DEFAULT 0,
      token_total      INTEGER NOT NULL DEFAULT 0
    );
  `);
}
