export const version = 8;

/**
 * frontdesk_decision — append-only log of every routing decision made by
 * the frontdesk (rules-only or rules+LLM). Drives the cheap learning loop:
 * the LLM stage samples its few-shots from rows where outcome='accepted'.
 *
 * Outcome is patched in later by the same hook that classifies session
 * outcomes (P1-6) — this migration leaves it nullable on insert.
 *
 * Schema mirrors arch §6.3.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS frontdesk_decision (
      id                INTEGER PRIMARY KEY,
      task_hash         TEXT NOT NULL,
      rules_applied     TEXT,        -- JSON array of rule ids
      llm_input         TEXT,        -- JSON: { task, candidates, ruleTrace }
      llm_output        TEXT,        -- JSON: validated proposal (or fallback)
      user_accepted     TEXT,        -- JSON: what the user actually launched with
      outcome           TEXT,        -- 'accepted' | 'partial' | 'rejected' | NULL
      created_at_epoch  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_frontdesk_decision_created_at
      ON frontdesk_decision(created_at_epoch DESC);

    CREATE INDEX IF NOT EXISTS idx_frontdesk_decision_outcome
      ON frontdesk_decision(outcome);
  `);
}
