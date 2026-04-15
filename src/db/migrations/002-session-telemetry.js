export const version = 2;

/**
 * Adds persistent telemetry fields needed by phase 5.
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`ALTER TABLE session ADD COLUMN provider_session_id TEXT;`);
  db.exec(`ALTER TABLE session ADD COLUMN system_prompt TEXT;`);
  db.exec(`ALTER TABLE session ADD COLUMN last_model TEXT;`);
  db.exec(`ALTER TABLE session ADD COLUMN cost_usd REAL;`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_session_started_at ON session(started_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_session_ended_at ON session(ended_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_session_provider_session_id ON session(provider_session_id);`);
}
