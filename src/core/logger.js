/**
 * Minimal structured logger.
 * Each log call writes a single JSON line to stdout:
 *   { ts, level, module, msg, ...data }
 */

function write(level, module, msg, data) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, module, msg, ...data });
  process.stdout.write(line + '\n');
}

export function createLogger(module) {
  return {
    info:  (msg, data = {}) => write('info',  module, msg, data),
    warn:  (msg, data = {}) => write('warn',  module, msg, data),
    error: (msg, data = {}) => write('error', module, msg, data),
    debug: (msg, data = {}) => write('debug', module, msg, data),
  };
}
