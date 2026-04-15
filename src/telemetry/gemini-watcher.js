import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createLiveSessionTracker } from './live-session-tracker.js';

export const DEFAULT_GEMINI_IDLE_MS = 90_000;

function defaultGeminiTmpRoot() {
  return `${homedir()}/.gemini/tmp`;
}

function readUtf8(path) {
  return readFileSync(path, 'utf8');
}

function parseGeminiSession(path) {
  let parsed;
  try {
    parsed = JSON.parse(readUtf8(path));
  } catch {
    return null;
  }

  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheRead = 0;
  let total = 0;
  let lastModel = null;
  let lastActivity = parsed?.lastUpdated ?? parsed?.startTime ?? null;

  for (const message of messages) {
    if (message?.timestamp) lastActivity = message.timestamp;
    if (message?.type !== 'gemini') continue;
    const usage = message.tokens ?? {};
    tokensIn += Number(usage.input ?? 0);
    tokensOut += Number(usage.output ?? 0);
    cacheRead += Number(usage.cached ?? 0);
    total += Number(usage.total ?? 0);
    lastModel = message.model ?? lastModel;
  }

  return {
    providerSessionId: parsed?.sessionId ?? basename(path, '.json'),
    lastActivity,
    lastModel,
    totals: {
      tokensIn,
      tokensOut,
      cacheRead,
      cacheWrite: 0,
      total: total || tokensIn + tokensOut + cacheRead,
    },
  };
}

export function createGeminiWatcher({
  rootPath = defaultGeminiTmpRoot(),
  // Gemini CLI can sit idle for tens of seconds between turns while tools run
  // or the main model hands off to a utility summarizer. A short idle window
  // truncates sessions before the final cumulative totals land on disk.
  idleMs = DEFAULT_GEMINI_IDLE_MS,
  pollMs = 2_000,
} = {}) {
  const tracker = createLiveSessionTracker({ idleMs, providerId: 'gemini-cli' });
  const fileState = new Map();
  let timer = null;

  function listProjectDirs() {
    try {
      return readdirSync(rootPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(rootPath, entry.name));
    } catch {
      return [];
    }
  }

  function listSessionFiles(projectDir) {
    const chatsDir = join(projectDir, 'chats');
    try {
      return readdirSync(chatsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.startsWith('session-') && entry.name.endsWith('.json'))
        .map((entry) => join(chatsDir, entry.name));
    } catch {
      return [];
    }
  }

  function pollOnce() {
    const projectDirs = listProjectDirs();
    for (const projectDir of projectDirs) {
      const marker = join(projectDir, '.project_root');
      if (!existsSync(marker)) continue;
      let projectPath;
      try {
        projectPath = readUtf8(marker).trim();
      } catch {
        continue;
      }
      if (!projectPath) continue;
      const sessionFiles = listSessionFiles(projectDir);
      for (const filePath of sessionFiles) {
        if (!existsSync(filePath)) continue;
        let stat;
        try {
          stat = statSync(filePath);
        } catch {
          continue;
        }
        const cached = fileState.get(filePath);
        if (cached?.mtimeMs === stat.mtimeMs) continue;
        const session = parseGeminiSession(filePath);
        if (!session?.providerSessionId) continue;
        fileState.set(filePath, { mtimeMs: stat.mtimeMs });
        tracker.updateAbsolute({
          providerId: 'gemini-cli',
          providerSessionId: session.providerSessionId,
          projectPath,
          lastActivity: session.lastActivity,
          lastModel: session.lastModel,
          totals: session.totals,
        });
      }
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

export { parseGeminiSession };
