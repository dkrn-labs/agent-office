/**
 * Single source of truth for the agent-office logger.
 *
 * Pino-backed under the hood, but emits the legacy
 * `{ ts, level, module, msg, ...data }` JSON-line shape that existing
 * call sites + tests assert against. Any string passed through the
 * logger (message + nested meta values) is redacted for known
 * secret-shaped substrings — Stripe sk_test_/sk_live_, Anthropic
 * sk-ant-, OpenAI sk-proj-/sk-openai-, GitHub gh[psorau]_, AWS AKIA…
 *
 * createLogger('module-name')          ← legacy call form, still works
 * createLogger({ level, destination, module })  ← new form for tests
 */

import pino from 'pino';

const SECRET_PATTERNS = [
  { re: /sk_test_[A-Za-z0-9]{16,}/g, replace: 'sk_test_REDACTED' },
  { re: /sk_live_[A-Za-z0-9]{16,}/g, replace: 'sk_live_REDACTED' },
  { re: /sk-ant-[A-Za-z0-9_-]{16,}/g, replace: 'sk-ant-REDACTED' },
  { re: /sk-proj-[A-Za-z0-9_-]{16,}/g, replace: 'sk-proj-REDACTED' },
  { re: /sk-openai-[A-Za-z0-9_-]{16,}/g, replace: 'sk-openai-REDACTED' },
  { re: /gh[psorau]_[A-Za-z0-9]{20,}/g, replace: (m) => `${m.slice(0, 4)}REDACTED` },
  { re: /\bAKIA[0-9A-Z]{12,}/g, replace: 'AKIA_REDACTED' },
];

export function redactSecretsInString(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  let out = s;
  for (const { re, replace } of SECRET_PATTERNS) out = out.replace(re, replace);
  return out;
}

function redactDeep(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactSecretsInString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, seen);
  return out;
}

/**
 * @param {string|object} arg — module name (legacy) or options object.
 */
export function createLogger(arg = {}) {
  const opts = typeof arg === 'string' ? { module: arg } : arg;
  const { module: moduleName, level = process.env.LOG_LEVEL ?? 'info', destination } = opts;

  const pinoOpts = {
    level,
    base: null, // suppress default `pid` + `hostname` so legacy shape stays clean
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
    messageKey: 'msg',
  };
  // Synchronous destination so the legacy stdout-capture test (which
  // replaces `process.stdout.write` for the duration of one call) sees
  // the line on the same tick. Asynchronous mode is the pino default
  // and would arrive after the test stops capturing.
  const dest = destination ?? pino.destination({ sync: true });
  const pinoLogger = pino(pinoOpts, dest);

  function emit(method, msg, data) {
    const safeMsg = redactSecretsInString(String(msg ?? ''));
    const meta = { ...(moduleName ? { module: moduleName } : {}), ...(data ? redactDeep(data) : {}) };
    pinoLogger[method](meta, safeMsg);
  }

  return {
    info(msg, data) { emit('info', msg, data); },
    warn(msg, data) { emit('warn', msg, data); },
    error(msg, data) { emit('error', msg, data); },
    debug(msg, data) { emit('debug', msg, data); },
    raw: pinoLogger,
  };
}

export const logger = createLogger();
