export const version = 1;

/**
 * Creates all v1 tables and indexes.
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  // ── Core domain tables ──────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS project (
      project_id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path                TEXT    NOT NULL UNIQUE,
      name                TEXT    NOT NULL,
      tech_stack          TEXT,   -- JSON array
      git_remote          TEXT,
      default_branch      TEXT,
      active              INTEGER NOT NULL DEFAULT 1,
      last_scanned_at     TEXT,
      stack_hash          TEXT,
      last_gardened_at    TEXT,
      garden_health_score REAL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS persona (
      persona_id              INTEGER PRIMARY KEY AUTOINCREMENT,
      label                   TEXT NOT NULL,
      domain                  TEXT NOT NULL,
      secondary_domains       TEXT,   -- JSON array
      character_sprite        TEXT,
      skill_ids               TEXT,   -- JSON array
      system_prompt_template  TEXT,
      source                  TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session (
      session_id        INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id        INTEGER NOT NULL REFERENCES project(project_id),
      persona_id        INTEGER NOT NULL REFERENCES persona(persona_id),
      provider_id       TEXT    NOT NULL DEFAULT 'claude-code',
      started_at        TEXT,
      ended_at          TEXT,
      tokens_in         INTEGER NOT NULL DEFAULT 0,
      tokens_out        INTEGER NOT NULL DEFAULT 0,
      tokens_cache_read INTEGER NOT NULL DEFAULT 0,
      tokens_cache_write INTEGER NOT NULL DEFAULT 0,
      commits_produced  INTEGER NOT NULL DEFAULT 0,
      diff_exists       INTEGER NOT NULL DEFAULT 0,
      outcome           TEXT    NOT NULL DEFAULT 'unknown',
      error             TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      memory_id           INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id          INTEGER NOT NULL REFERENCES project(project_id),
      domain              TEXT    NOT NULL,
      type                TEXT    NOT NULL,
      content             TEXT    NOT NULL,
      status              TEXT    NOT NULL DEFAULT 'active',
      confidence_score    REAL    NOT NULL DEFAULT 1.0,
      created_at          TEXT,
      last_verified_at    TEXT,
      verification_count  INTEGER NOT NULL DEFAULT 0,
      staleness_signal    TEXT,
      expires_at          TEXT,
      source_persona_id   INTEGER REFERENCES persona(persona_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS skill (
      skill_id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name                TEXT NOT NULL,
      domain              TEXT NOT NULL,
      applicable_stacks   TEXT,   -- JSON array
      content             TEXT    NOT NULL,
      source              TEXT    NOT NULL DEFAULT 'built-in',
      last_used_at        TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS garden_log (
      garden_log_id       INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id          INTEGER NOT NULL REFERENCES project(project_id),
      run_at              TEXT    NOT NULL,
      strategy            TEXT,
      memories_reviewed   INTEGER NOT NULL DEFAULT 0,
      memories_updated    INTEGER NOT NULL DEFAULT 0,
      memories_archived   INTEGER NOT NULL DEFAULT 0,
      memories_created    INTEGER NOT NULL DEFAULT 0,
      skills_suggested    TEXT,   -- JSON array
      claude_md_changes   TEXT,
      tokens_used         INTEGER NOT NULL DEFAULT 0,
      budget_remaining    INTEGER NOT NULL DEFAULT 0,
      approved            INTEGER,
      error               TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS garden_rule (
      rule_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      scope       TEXT    NOT NULL DEFAULT 'global',
      project_id  INTEGER REFERENCES project(project_id),
      schedule    TEXT,
      strategy    TEXT,
      config      TEXT    NOT NULL DEFAULT '{}'   -- JSON object
    );
  `);

  // ── Future placeholder tables (empty, no columns beyond PK) ─────────────────

  db.exec(`CREATE TABLE IF NOT EXISTS provider      (provider_id  INTEGER PRIMARY KEY AUTOINCREMENT);`);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow      (workflow_id  INTEGER PRIMARY KEY AUTOINCREMENT);`);
  db.exec(`CREATE TABLE IF NOT EXISTS user          (user_id      INTEGER PRIMARY KEY AUTOINCREMENT);`);
  db.exec(`CREATE TABLE IF NOT EXISTS skill_session (id           INTEGER PRIMARY KEY AUTOINCREMENT);`);

  // ── Indexes ──────────────────────────────────────────────────────────────────

  db.exec(`CREATE INDEX IF NOT EXISTS idx_session_project_id  ON session(project_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_session_persona_id  ON session(persona_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_project_domain ON memory(project_id, domain);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_status        ON memory(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_domain         ON skill(domain);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_garden_log_project   ON garden_log(project_id);`);
}
