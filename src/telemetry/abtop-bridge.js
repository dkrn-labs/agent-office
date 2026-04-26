/**
 * abtop-bridge — periodically spawn `abtop --once`, parse the output,
 * diff against last snapshot, emit `session:detail:tick` events on
 * changed fields.
 *
 * No upstream changes to abtop required. If/when graykode/abtop adds
 * a `--rpc` mode, this module gets replaced by a socket subscriber
 * with the same external surface.
 */

import { EventEmitter } from 'node:events';
import { execFile as nodeExecFile } from 'node:child_process';

import { parseAbtopOutput } from './abtop-parser.js';

function defaultRunner(binPath, args, { timeoutMs }) {
  return new Promise((resolve) => {
    nodeExecFile(binPath, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) resolve({ ok: false, error: err, stdout: '' });
      else resolve({ ok: true, stdout: String(stdout ?? '') });
    });
  });
}

const noopLog = { warn: () => {}, info: () => {} };

const TICK_FIELDS = ['status', 'model', 'ctxPct', 'tokensTotal', 'memMB', 'wallTimeSec', 'currentTask', 'lastAction'];

function changed(prev, next) {
  if (!prev) return true;
  for (const k of TICK_FIELDS) {
    if (prev[k] !== next[k]) return true;
  }
  return false;
}

/**
 * @param {{
 *   binPath?: string,
 *   pollMs?: number,
 *   timeoutMs?: number,
 *   execFile?: typeof import('node:child_process').execFile,
 *   log?: { warn: Function, info?: Function },
 * }} [opts]
 */
export function createAbtopBridge({
  binPath = 'abtop',
  pollMs = 3000,
  timeoutMs = 2000,
  runner = defaultRunner,
  log = noopLog,
} = {}) {
  const emitter = new EventEmitter();
  let timer = null;
  let cached = { totalSessions: 0, sessions: [] };
  const lastByPid = new Map();

  async function refresh() {
    const r = await runner(binPath, ['--once'], { timeoutMs });
    if (!r.ok) {
      log.warn(`[abtop-bridge] ${binPath} --once failed: ${r.error?.message ?? r.error}`);
      return;
    }
    const next = parseAbtopOutput(r.stdout);
    cached = next;

    // Diff per PID. Emit tick for new sessions and changed sessions.
    const seenPids = new Set();
    for (const s of next.sessions) {
      seenPids.add(s.pid);
      const prev = lastByPid.get(s.pid);
      if (changed(prev, s)) emitter.emit('session:detail:tick', s);
      lastByPid.set(s.pid, s);
    }
    // Emit "gone" for sessions that disappeared between polls.
    for (const pid of [...lastByPid.keys()]) {
      if (!seenPids.has(pid)) {
        emitter.emit('session:detail:gone', { pid });
        lastByPid.delete(pid);
      }
    }
  }

  return {
    snapshot() { return cached; },
    on(name, fn) { emitter.on(name, fn); return () => emitter.off(name, fn); },
    refresh,
    async start() {
      if (timer) return;
      await refresh();
      timer = setInterval(() => { refresh(); }, pollMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}
