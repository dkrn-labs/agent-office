export const version = 4;

/**
 * Adds provider-neutral project history tables for summaries and observations
 * that can be ingested from any CLI without requiring a persona-bound session.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS history_session (
      history_session_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id           INTEGER NOT NULL REFERENCES project(project_id),
      persona_id           INTEGER REFERENCES persona(persona_id),
      provider_id          TEXT NOT NULL,
      provider_session_id  TEXT,
      started_at           TEXT,
      ended_at             TEXT,
      status               TEXT NOT NULL DEFAULT 'completed',
      model                TEXT,
      system_prompt        TEXT,
      source               TEXT NOT NULL DEFAULT 'provider-hook',
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS history_summary (
      history_summary_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      history_session_id   INTEGER NOT NULL REFERENCES history_session(history_session_id) ON DELETE CASCADE,
      project_id           INTEGER NOT NULL REFERENCES project(project_id),
      provider_id          TEXT NOT NULL,
      summary_kind         TEXT NOT NULL DEFAULT 'checkpoint',
      request              TEXT,
      investigated         TEXT,
      learned              TEXT,
      completed            TEXT,
      next_steps           TEXT,
      files_read           TEXT,
      files_edited         TEXT,
      notes                TEXT,
      created_at           TEXT NOT NULL,
      created_at_epoch     INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS history_observation (
      history_observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      history_session_id     INTEGER NOT NULL REFERENCES history_session(history_session_id) ON DELETE CASCADE,
      project_id             INTEGER NOT NULL REFERENCES project(project_id),
      provider_id            TEXT NOT NULL,
      type                   TEXT NOT NULL,
      title                  TEXT,
      subtitle               TEXT,
      narrative              TEXT,
      facts                  TEXT,
      concepts               TEXT,
      files_read             TEXT,
      files_modified         TEXT,
      turn_number            INTEGER,
      content_hash           TEXT,
      generated_by_model     TEXT,
      relevance_count        INTEGER NOT NULL DEFAULT 0,
      confidence             REAL NOT NULL DEFAULT 1.0,
      created_at             TEXT NOT NULL,
      created_at_epoch       INTEGER NOT NULL,
      expires_at             TEXT
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_session_project
      ON history_session(project_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_session_updated_at
      ON history_session(updated_at DESC);
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_history_session_provider_lookup
      ON history_session(provider_id, provider_session_id)
      WHERE provider_session_id IS NOT NULL;
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_summary_project_created
      ON history_summary(project_id, created_at_epoch DESC);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_summary_session
      ON history_summary(history_session_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_observation_project_created
      ON history_observation(project_id, created_at_epoch DESC);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_observation_session
      ON history_observation(history_session_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_observation_type
      ON history_observation(type);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_observation_hash
      ON history_observation(content_hash, created_at_epoch DESC);
  `);
}
