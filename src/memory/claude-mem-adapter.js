import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

/**
 * Read-only adapter for the claude-mem SQLite database.
 *
 * @param {string} dbPath absolute path to claude-mem.db
 * @returns {{
 *   getLastSession: (projectName: string) => { title: string|null, completed: string|null, nextSteps: string|null, at: string } | null,
 *   getObservations: (projectName: string, options?: { limit?: number }) => Array<{ id: number, title: string, subtitle: string|null, narrative: string, type: string, filesModified: string[], createdAt: string }>,
 *   close: () => void,
 * } | null}
 */
export function createClaudeMemAdapter(dbPath) {
  if (!existsSync(dbPath)) return null;

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const getLastSessionStmt = db.prepare(`
    SELECT s.custom_title AS title, s.started_at AS at,
           ss.completed, ss.next_steps AS nextSteps
      FROM sdk_sessions s
      LEFT JOIN session_summaries ss
        ON ss.memory_session_id = s.memory_session_id
     WHERE s.project = ?
     ORDER BY s.started_at_epoch DESC
     LIMIT 1
  `);

  const getObservationsStmt = db.prepare(`
    SELECT id, title, subtitle, narrative, type, files_modified AS filesModified, created_at AS createdAt
      FROM observations
     WHERE project = ?
     ORDER BY created_at_epoch DESC
     LIMIT ?
  `);

  function parseFiles(json) {
    if (!json) return [];
    try { return JSON.parse(json); } catch { return []; }
  }

  return {
    getLastSession(projectName) {
      const row = getLastSessionStmt.get(projectName);
      if (!row) return null;
      return {
        title: row.title,
        completed: row.completed,
        nextSteps: row.nextSteps,
        at: row.at,
      };
    },

    getObservations(projectName, { limit = 50 } = {}) {
      const rows = getObservationsStmt.all(projectName, limit);
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
        narrative: r.narrative,
        type: r.type,
        filesModified: parseFiles(r.filesModified),
        createdAt: r.createdAt,
      }));
    },

    close() {
      db.close();
    },
  };
}

/**
 * Default path for the claude-mem database.
 * @returns {string}
 */
export function defaultClaudeMemPath() {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return `${home}/.claude-mem/claude-mem.db`;
}
