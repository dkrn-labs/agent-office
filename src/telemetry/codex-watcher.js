import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { createLiveSessionTracker } from './live-session-tracker.js';

export const DEFAULT_CODEX_IDLE_MS = 60_000;

function defaultCodexStatePath() {
  return `${homedir()}/.codex/state_5.sqlite`;
}

function toIsoFromEpochSeconds(value) {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return new Date(num * 1000).toISOString();
}

export function createCodexWatcher({
  dbPath = defaultCodexStatePath(),
  // Codex threads can go quiet for a while during longer reasoning/tool phases.
  idleMs = DEFAULT_CODEX_IDLE_MS,
  expiryMs,
  pollMs = 2_000,
  createUnattended = null,
} = {}) {
  const tracker = createLiveSessionTracker({ idleMs, expiryMs, providerId: 'codex', createUnattended });
  let timer = null;
  let db = null;
  const seen = new Map();

  function ensureDb() {
    if (db) return db;
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return db;
  }

  function pollOnce() {
    let rows = [];
    try {
      rows = ensureDb().prepare(`
        SELECT id, cwd, model, tokens_used, updated_at
        FROM threads
        ORDER BY updated_at DESC
        LIMIT 100
      `).all();
    } catch {
      return;
    }

    for (const row of rows) {
      if (!row?.id || !row?.cwd) continue;
      const total = Number(row.tokens_used ?? 0);
      const updatedAt = Number(row.updated_at ?? 0);
      const key = row.id;
      const prev = seen.get(key);
      if (prev && prev.total === total && prev.updatedAt === updatedAt && prev.model === row.model) continue;
      seen.set(key, { total, updatedAt, model: row.model ?? null });
      tracker.updateAbsolute({
        providerId: 'codex',
        providerSessionId: row.id,
        projectPath: row.cwd,
        lastActivity: toIsoFromEpochSeconds(updatedAt),
        lastModel: row.model ?? null,
        totals: {
          tokensIn: total,
          tokensOut: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total,
        },
      });
    }
  }

  return {
    start() {
      if (timer) return;
      pollOnce();
      timer = setInterval(pollOnce, pollMs);
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      tracker.stop();
      db?.close?.();
      db = null;
    },
    registerLaunch(payload) {
      tracker.registerLaunch(payload);
    },
    snapshot() {
      return tracker.snapshot();
    },
    on(eventName, handler) {
      return tracker.on(eventName, handler);
    },
    pollOnce,
  };
}
