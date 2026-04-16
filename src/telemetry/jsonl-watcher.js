import { EventEmitter } from 'node:events';
import { createReadStream, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { watch } from 'chokidar';
import { decodeProjectPath, defaultClaudeProjectsRoot } from './claude-projects-path.js';

export function parseUsageLine(line) {
  if (!line || line.length < 2) return null;

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const usage = parsed?.message?.usage;
  if (!usage) return null;

  return {
    providerSessionId: parsed.sessionId ?? null,
    cwd: parsed.cwd ?? null,
    timestamp: parsed.timestamp ?? null,
    model: parsed.message?.model ?? parsed.model ?? null,
    tokensIn: usage.input_tokens ?? 0,
    tokensOut: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
}

function emptyTotals() {
  return {
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
}

export function createJsonlWatcher({
  rootPath = defaultClaudeProjectsRoot(),
  idleMs = 10_000,
  expiryMs = Math.max(idleMs, 5 * 60 * 1000),
} = {}) {
  const emitter = new EventEmitter();
  const fileCursors = new Map();
  const pendingLaunches = [];
  const sessionsByProvider = new Map();
  let watcher = null;

  function prunePending() {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (let i = pendingLaunches.length - 1; i >= 0; i -= 1) {
      if ((pendingLaunches[i].registeredAt ?? 0) < cutoff) {
        pendingLaunches.splice(i, 1);
      }
    }
  }

  function registerLaunch({ projectPath, sessionId, personaId, projectId, launchedAt, providerId }) {
    if (providerId && providerId !== 'claude-code') return;
    pendingLaunches.push({
      projectPath,
      sessionId,
      personaId,
      projectId,
      launchedAt: launchedAt ?? new Date().toISOString(),
      providerId: providerId ?? 'claude-code',
      registeredAt: Date.now(),
    });
    prunePending();
  }

  function claimLaunch(projectPath) {
    prunePending();
    const index = pendingLaunches.findIndex((entry) => entry.projectPath === projectPath);
    if (index === -1) return null;
    return pendingLaunches.splice(index, 1)[0];
  }

  function buildSnapshot(entry) {
    return {
      sessionId: entry.sessionId,
      providerSessionId: entry.providerSessionId,
      personaId: entry.personaId,
      projectId: entry.projectId,
      projectPath: entry.projectPath,
      startedAt: entry.startedAt,
      lastActivity: entry.lastActivity,
      lastModel: entry.lastModel,
      working: !entry.isIdle,
      totals: { ...entry.totals },
    };
  }

  function emitExpired(entry) {
    sessionsByProvider.delete(entry.providerSessionId);
    emitter.emit('session:expired', {
      sessionId: entry.sessionId,
      providerSessionId: entry.providerSessionId,
      personaId: entry.personaId,
      projectId: entry.projectId,
      projectPath: entry.projectPath,
      lastActivity: entry.lastActivity,
    });
  }

  function applyUsage(providerSessionId, projectPath, usage) {
    let entry = sessionsByProvider.get(providerSessionId);
    if (!entry) {
      const claimed = claimLaunch(projectPath);
      if (!claimed) return null;

      entry = {
        providerSessionId,
        sessionId: claimed.sessionId,
        personaId: claimed.personaId,
        projectId: claimed.projectId,
        projectPath,
        startedAt: claimed.launchedAt,
        lastActivity: claimed.launchedAt,
        lastModel: null,
        totals: emptyTotals(),
        idleTimer: null,
        expiryTimer: null,
        isIdle: false,
      };
      sessionsByProvider.set(providerSessionId, entry);
    }

    const wasIdle = entry.isIdle === true;
    entry.totals.tokensIn += usage.tokensIn;
    entry.totals.tokensOut += usage.tokensOut;
    entry.totals.cacheRead += usage.cacheRead;
    entry.totals.cacheWrite += usage.cacheWrite;
    entry.totals.total =
      entry.totals.tokensIn +
      entry.totals.tokensOut +
      entry.totals.cacheRead +
      entry.totals.cacheWrite;
    entry.lastActivity = usage.timestamp ?? new Date().toISOString();
    entry.lastModel = usage.model ?? entry.lastModel ?? null;
    entry.isIdle = false;

    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.idleTimer = setTimeout(() => {
      entry.isIdle = true;
      emitter.emit('session:idle', {
        sessionId: entry.sessionId,
        providerSessionId: entry.providerSessionId,
        personaId: entry.personaId,
        projectId: entry.projectId,
        projectPath: entry.projectPath,
        lastActivity: entry.lastActivity,
      });
    }, idleMs);
    entry.expiryTimer = setTimeout(() => emitExpired(entry), expiryMs);

    const snapshot = buildSnapshot(entry);
    if (
      wasIdle ||
      usage.tokensIn > 0 ||
      usage.tokensOut > 0 ||
      usage.cacheRead > 0 ||
      usage.cacheWrite > 0 ||
      usage.model
    ) {
      emitter.emit('session:update', snapshot);
    }
    return snapshot;
  }

  async function handleChange(filePath) {
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return;
    }

    const cursor = fileCursors.get(filePath) ?? { offset: 0 };
    // Only rewind when the file was truncated or rotated.
    if (stat.size < cursor.offset) cursor.offset = 0;

    const stream = createReadStream(filePath, {
      start: cursor.offset,
      encoding: 'utf8',
    });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let bytesRead = cursor.offset;
    for await (const line of rl) {
      bytesRead += Buffer.byteLength(line, 'utf8') + 1;
      const usage = parseUsageLine(line);
      if (!usage) continue;
      const encodedProject = basename(dirname(filePath));
      const projectPath = usage.cwd ?? decodeProjectPath(encodedProject);
      const providerSessionId = usage.providerSessionId ?? basename(filePath, '.jsonl');
      if (!projectPath || !providerSessionId) continue;
      applyUsage(providerSessionId, projectPath, usage);
    }

    cursor.offset = Math.max(bytesRead, stat.size);
    fileCursors.set(filePath, cursor);
  }

  function start() {
    if (watcher) return;
    watcher = watch(`${rootPath}/**/*.jsonl`, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    });
    watcher.on('add', handleChange);
    watcher.on('change', handleChange);
  }

  async function stop() {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
    for (const entry of sessionsByProvider.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    }
    sessionsByProvider.clear();
  }

  function snapshot() {
    return Array.from(sessionsByProvider.values()).map(buildSnapshot);
  }

  return {
    start,
    stop,
    registerLaunch,
    ingestUsage(providerSessionId, projectPath, usage) {
      return applyUsage(providerSessionId, projectPath, usage);
    },
    snapshot,
    on(eventName, handler) {
      emitter.on(eventName, handler);
      return () => emitter.off(eventName, handler);
    },
  };
}
