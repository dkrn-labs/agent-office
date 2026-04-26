/**
 * Aider chat-history tail watcher (P3-6).
 *
 * Aider runs per-project. Unlike claude/codex/gemini we don't discover
 * sessions by scanning a global directory — the launcher tells us which
 * project paths are alive via `registerLaunch`, and we poll the
 * `.aider.chat.history.md` file in each.
 *
 * Token counts come from a chars/4 estimate — Aider doesn't emit usage
 * the way the cloud CLIs do. Snapshots set `totals.source = 'estimated'`
 * so the savings ledger can flag the row.
 */

import { EventEmitter } from 'node:events';
import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_HISTORY_FILE = '.aider.chat.history.md';

/**
 * @param {string} content
 * @returns {{ estimatedTokens: number, source: 'estimated' }}
 */
export function parseAiderHistory(content = '') {
  const len = typeof content === 'string' ? content.length : 0;
  return { estimatedTokens: Math.floor(len / 4), source: 'estimated' };
}

export const DEFAULT_AIDER_IDLE_MS = 90_000;
export const DEFAULT_AIDER_EXPIRY_MS = 10 * 60 * 1000;

/**
 * @param {{
 *   pollMs?: number,
 *   idleMs?: number,
 *   expiryMs?: number,
 *   historyFilename?: string,
 * }} [opts]
 */
export function createAiderWatcher({
  pollMs = 2_000,
  idleMs = DEFAULT_AIDER_IDLE_MS,
  expiryMs = DEFAULT_AIDER_EXPIRY_MS,
  historyFilename = DEFAULT_HISTORY_FILE,
} = {}) {
  const emitter = new EventEmitter();
  const launches = new Map(); // providerSessionId → entry
  let timer = null;

  function buildSnapshot(entry) {
    return {
      sessionId: entry.sessionId ?? null,
      historySessionId: entry.historySessionId ?? null,
      providerSessionId: entry.providerSessionId,
      providerId: 'aider-local',
      projectPath: entry.projectPath,
      startedAt: entry.startedAt,
      lastActivity: entry.lastActivity,
      lastModel: entry.lastModel ?? null,
      working: !entry.isIdle,
      totals: {
        tokensIn: entry.estimatedTokens,
        tokensOut: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: entry.estimatedTokens,
        source: 'estimated',
      },
      unattended: false,
    };
  }

  function armIdle(entry) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.idleTimer = setTimeout(() => {
      entry.isIdle = true;
      emitter.emit('session:idle', buildSnapshot(entry));
    }, idleMs);
    entry.expiryTimer = setTimeout(() => {
      launches.delete(entry.providerSessionId);
      emitter.emit('session:expired', buildSnapshot(entry));
    }, expiryMs);
  }

  function registerLaunch({
    providerSessionId,
    projectPath,
    historySessionId = null,
    sessionId = null,
    launchedAt = new Date().toISOString(),
  }) {
    if (!providerSessionId || !projectPath) return;
    const entry = {
      providerSessionId,
      projectPath,
      historySessionId,
      sessionId,
      historyFile: path.join(projectPath, historyFilename),
      lastSize: -1,
      estimatedTokens: 0,
      lastActivity: launchedAt,
      startedAt: launchedAt,
      isIdle: false,
      idleTimer: null,
      expiryTimer: null,
    };
    launches.set(providerSessionId, entry);
    armIdle(entry);
  }

  async function pollOnce() {
    for (const entry of launches.values()) {
      if (!existsSync(entry.historyFile)) continue;
      let stat;
      try { stat = statSync(entry.historyFile); }
      catch { continue; }
      if (stat.size === entry.lastSize) continue;

      let content = '';
      try { content = readFileSync(entry.historyFile, 'utf8'); }
      catch { continue; }
      const { estimatedTokens } = parseAiderHistory(content);

      entry.lastSize = stat.size;
      entry.estimatedTokens = estimatedTokens;
      entry.lastActivity = new Date(stat.mtimeMs).toISOString();
      entry.isIdle = false;
      armIdle(entry);
      emitter.emit('session:update', buildSnapshot(entry));
    }
  }

  return {
    start() {
      if (timer) return;
      pollOnce();
      timer = setInterval(pollOnce, pollMs);
    },
    async stop() {
      if (timer) { clearInterval(timer); timer = null; }
      for (const entry of launches.values()) {
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
      }
      launches.clear();
    },
    registerLaunch,
    snapshot() { return [...launches.values()].map(buildSnapshot); },
    on(eventName, handler) { emitter.on(eventName, handler); return () => emitter.off(eventName, handler); },
    pollOnce,
  };
}
