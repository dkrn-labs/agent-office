/**
 * Pure parser for `abtop --once` snapshot output.
 *
 * abtop is graykode/abtop (MIT) — htop for AI coding agents. Its
 * `--once` mode prints a structured text snapshot and exits. We poll
 * that, parse it, and stream deltas onto the agent-office event bus.
 *
 * No I/O. No subprocess. Test with fixtures.
 *
 * Hard rule: every secret-shaped substring is redacted before the
 * parser ever returns. Child-process command lines often contain
 * keys (Stripe MCP, AWS credentials, GitHub tokens). Those must NOT
 * reach ws-bus or the UI.
 */

const SECRET_PATTERNS = [
  // Stripe — sk_test_, sk_live_ followed by long token
  { re: /sk_test_[A-Za-z0-9]{16,}/g, replace: 'sk_test_REDACTED' },
  { re: /sk_live_[A-Za-z0-9]{16,}/g, replace: 'sk_live_REDACTED' },
  // Anthropic
  { re: /sk-ant-[A-Za-z0-9_-]{16,}/g, replace: 'sk-ant-REDACTED' },
  // OpenAI (sk-proj-, sk-openai-, classic sk-)
  { re: /sk-proj-[A-Za-z0-9_-]{16,}/g, replace: 'sk-proj-REDACTED' },
  { re: /sk-openai-[A-Za-z0-9_-]{16,}/g, replace: 'sk-openai-REDACTED' },
  // GitHub PAT / OAuth / app
  { re: /gh[psorau]_[A-Za-z0-9]{20,}/g, replace: (m) => `${m.slice(0, 4)}REDACTED` },
  // AWS access key id
  { re: /\bAKIA[0-9A-Z]{12,}/g, replace: 'AKIA_REDACTED' },
];

export function redactSecrets(input) {
  if (typeof input !== 'string' || input.length === 0) return input;
  let s = input;
  for (const { re, replace } of SECRET_PATTERNS) {
    s = s.replace(re, replace);
  }
  return s;
}

const STATUS_GLYPH_MAP = {
  '◌': 'wait',
  '◉': 'think',
  '◍': 'tool',
  '○': 'idle',
  '⚠': 'rate-limited',
};

function parseStatus(text) {
  for (const [glyph, label] of Object.entries(STATUS_GLYPH_MAP)) {
    if (text.includes(glyph)) return label;
  }
  // Fall back to lowercase keyword match (RateLimit / Wait / etc.)
  const m = text.match(/\b(RateLimit|Wait|Think|Tool|Idle)\b/);
  return m ? m[1].toLowerCase().replace('ratelimit', 'rate-limited') : null;
}

function parseTokens(s) {
  // "222.2M" / "80.5M" / "5.0K" → number
  const m = String(s).match(/^([\d.]+)([KMG]?)$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, G: 1e9 }[m[2].toUpperCase()] ?? 1;
  return Math.round(n * mult);
}

function parseWallTime(s) {
  // "6h 16m" / "16h 41m" / "45m" / "30s"
  let total = 0;
  const h = s.match(/(\d+)h/);
  const m = s.match(/(\d+)m/);
  const sec = s.match(/(\d+)s/);
  if (h) total += parseInt(h[1], 10) * 3600;
  if (m) total += parseInt(m[1], 10) * 60;
  if (sec) total += parseInt(sec[1], 10);
  return total;
}

/**
 * Top-level session line shape (after status glyph normalization):
 *   "  PID  project(thread)  task...  <status> model   CTX: NN% Tok:NN.NM Mem:NNNM Hh Mm"
 *
 * The task can contain arbitrary text including parentheses, so we
 * anchor on the structured tail (CTX/Tok/Mem/wall-time) and back out
 * from there.
 */
const TAIL_RE =
  /\s+([A-Za-z][\w.-]*)\s+CTX:\s*(\d+)%\s+Tok:([\d.]+[KMG]?)\s+Mem:(\d+)([KMG])\s+([^\s].+)$/;
const HEAD_RE = /^\s*(\d+)\s+([^\s(]+)\(([^)]+)\)\s+(.*)$/;
const CHILD_RE = /^\s+(\d+)\s+(.*?)\s+(\d+[KMG])\s*$/;
const LAST_ACTION_RE = /^\s+└─\s*(.+?)\s*$/;

export function parseAbtopOutput(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('abtop')) {
    return { totalSessions: 0, sessions: [] };
  }
  const headerMatch = raw.match(/^abtop —\s*(\d+)\s*sessions?/);
  const totalSessions = headerMatch ? parseInt(headerMatch[1], 10) : 0;

  const lines = raw.split(/\r?\n/);
  const sessions = [];
  let current = null;

  for (const rawLine of lines) {
    const line = redactSecrets(rawLine);

    // Top-level session line — must contain the structured CTX/Tok/Mem tail.
    const tail = line.match(TAIL_RE);
    if (tail && /^\s+\d+\s/.test(line.replace(TAIL_RE, ''))) {
      // First, peel the tail off, then parse the head.
      const head = line.replace(TAIL_RE, '').match(HEAD_RE);
      if (head) {
        const [, pid, projectName, projectId, taskAndStatus] = head;
        const [, model, ctxPct, tok, memNum, memUnit, wall] = tail;
        const status = parseStatus(taskAndStatus);
        // Strip trailing status glyph + label from the task text.
        const currentTask = taskAndStatus
          .replace(/\s*[◌◉◍○⚠]\s*(Wait|Think|Tool|Idle|RateLimit)\s*$/i, '')
          .trim();

        if (current) sessions.push(current);
        current = {
          pid: parseInt(pid, 10),
          projectName,
          projectId,
          currentTask,
          status,
          model,
          ctxPct: parseInt(ctxPct, 10) / 100,
          tokensTotal: parseTokens(tok),
          memMB: memUnit.toUpperCase() === 'M' ? parseInt(memNum, 10) : Math.round(parseInt(memNum, 10) * ({ K: 1e-3, G: 1e3 }[memUnit.toUpperCase()] ?? 1)),
          wallTimeSec: parseWallTime(wall),
          lastAction: null,
          children: [],
        };
        continue;
      }
    }

    if (!current) continue;

    const action = line.match(LAST_ACTION_RE);
    if (action) {
      current.lastAction = action[1];
      continue;
    }

    const child = line.match(CHILD_RE);
    if (child) {
      current.children.push({
        pid: parseInt(child[1], 10),
        command: child[2],
        memSize: child[3],
      });
    }
  }
  if (current) sessions.push(current);

  return { totalSessions, sessions };
}
