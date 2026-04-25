/**
 * In-process PTY host backed by node-pty.
 *
 * For P1-9 / MVP only — provides spawn/attach/replay primitives the v2
 * UI's xterm pane consumes. P4 may swap this for a Rust pty-hub sidecar
 * if we observe rendering glitches under load. The contract here is the
 * boundary against which both backends will conform.
 */

import { spawn as ptySpawn } from 'node-pty';
import { randomUUID } from 'node:crypto';

const REPLAY_BUFFER_BYTES = 256 * 1024; // 256 KB ring per session

export function createPtyHost() {
  /** @type {Map<string, PtySession>} */
  const sessions = new Map();

  /**
   * @typedef {object} PtySession
   * @property {string} ptyId
   * @property {import('node-pty').IPty} pty
   * @property {Set<import('ws').WebSocket>} clients
   * @property {string[]} replayBuffer       (kept under REPLAY_BUFFER_BYTES total)
   * @property {number} replayBytes
   * @property {string} bin
   * @property {string[]} args
   * @property {{ rows: number, cols: number }} size
   * @property {number} createdAt
   * @property {boolean} closed
   */

  /**
   * Create a new PTY session.
   *
   * @param {{ argv: string[], env?: Record<string,string>, cwd: string, cols?: number, rows?: number, label?: string }} opts
   * @returns {{ ptyId: string }}
   */
  function create({ argv, env = {}, cwd, cols = 100, rows = 30, label = null }) {
    if (!Array.isArray(argv) || argv.length === 0) {
      throw new Error('argv must be a non-empty array');
    }
    const [bin, ...args] = argv;
    const ptyId = randomUUID();
    const pty = ptySpawn(bin, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, ...env },
    });
    const session = {
      ptyId,
      pty,
      clients: new Set(),
      replayBuffer: [],
      replayBytes: 0,
      bin,
      args,
      size: { cols, rows },
      label,
      createdAt: Date.now(),
      closed: false,
    };
    sessions.set(ptyId, session);

    pty.onData((data) => {
      pushReplay(session, data);
      for (const ws of session.clients) {
        if (ws.readyState === ws.OPEN) ws.send(data);
      }
    });
    pty.onExit(({ exitCode }) => {
      session.closed = true;
      for (const ws of session.clients) {
        try {
          if (ws.readyState === ws.OPEN) ws.send(`\r\n\x1b[2m[pty exited code=${exitCode}]\x1b[0m\r\n`);
          ws.close(1000, 'pty exited');
        } catch {}
      }
      session.clients.clear();
    });

    return { ptyId };
  }

  /**
   * Attach a WebSocket to an existing session. Caller is responsible for the
   * actual WS handshake; this just plumbs IO.
   */
  function attach(ptyId, ws) {
    const session = sessions.get(ptyId);
    if (!session) {
      ws.close(4404, 'pty session not found');
      return;
    }
    if (session.closed) {
      ws.close(1000, 'pty already exited');
      return;
    }
    session.clients.add(ws);
    // Replay buffer (so a reload still sees recent output)
    if (session.replayBuffer.length > 0) {
      try { ws.send(session.replayBuffer.join('')); } catch {}
    }
    ws.on('message', (raw) => {
      let msg;
      // Control frames are JSON; everything else is raw bytes for stdin.
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
      } catch {
        msg = null;
      }
      if (msg && typeof msg === 'object' && msg.type) {
        if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
          try {
            session.pty.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
            session.size = { cols: msg.cols, rows: msg.rows };
          } catch {}
        } else if (msg.type === 'kill') {
          try { session.pty.kill(msg.signal ?? undefined); } catch {}
        }
        return;
      }
      // Treat as stdin
      try { session.pty.write(typeof raw === 'string' ? raw : raw.toString('utf8')); } catch {}
    });
    ws.on('close', () => session.clients.delete(ws));
    ws.on('error', () => session.clients.delete(ws));
  }

  function get(ptyId) {
    return sessions.get(ptyId) ?? null;
  }

  function list() {
    return [...sessions.values()].map((s) => ({
      ptyId: s.ptyId,
      bin: s.bin,
      label: s.label,
      cwd: s.pty.cwd ?? null,
      size: s.size,
      clients: s.clients.size,
      createdAt: s.createdAt,
      closed: s.closed,
    }));
  }

  function kill(ptyId, signal) {
    const session = sessions.get(ptyId);
    if (!session) return false;
    try { session.pty.kill(signal); } catch {}
    return true;
  }

  function pushReplay(session, chunk) {
    session.replayBuffer.push(chunk);
    session.replayBytes += chunk.length;
    while (session.replayBytes > REPLAY_BUFFER_BYTES && session.replayBuffer.length > 1) {
      const dropped = session.replayBuffer.shift();
      session.replayBytes -= dropped.length;
    }
  }

  function close() {
    for (const session of sessions.values()) {
      try { session.pty.kill(); } catch {}
      for (const ws of session.clients) { try { ws.close(); } catch {} }
    }
    sessions.clear();
  }

  return { create, attach, get, list, kill, close };
}
