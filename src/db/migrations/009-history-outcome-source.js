export const version = 9;

/**
 * P5-C — track WHO set a session's outcome so the heuristic
 * (`inferOutcome`) can defer to operator clicks.
 *
 *   outcome_source = 'operator' | 'heuristic' | 'hook' | NULL
 *
 * Sits on the existing `history_session_metrics` table next to the
 * `outcome` column it qualifies. NULL until something writes an
 * outcome. After P5-C2, the heuristic will skip the row when
 * outcome_source = 'operator' so operator clicks always win.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    ALTER TABLE history_session_metrics
      ADD COLUMN outcome_source TEXT;
  `);
}
