/**
 * Shared hook-installer helpers.
 *
 * Extracted from `scripts/install-hooks.js` so each `ProviderAdapter`
 * can expose an `installHook()` method that delegates to the same
 * idempotent implementation the manual installer uses. Boot-time
 * wiring (server.js) calls `provider.installHook()` per registered
 * adapter; the standalone CLI calls these same helpers.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_HOOK_SCRIPT = join(REPO_ROOT, 'scripts', 'provider-history-hook.js');

function readJson(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (err) { throw new Error(`failed to parse ${path}: ${err.message}`); }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** @returns {{ provider: string, changed: boolean, path: string, reason?: string }} */
export function ensureClaudeHook({ home = homedir(), hookScript = DEFAULT_HOOK_SCRIPT } = {}) {
  const path = join(home, '.claude', 'settings.json');
  const settings = readJson(path);
  const expectedCmd = `node ${hookScript} --provider claude-code`;
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];
  const installed = settings.hooks.Stop.some((entry) =>
    Array.isArray(entry?.hooks) && entry.hooks.some((h) => h?.type === 'command' && h?.command === expectedCmd),
  );
  if (installed) return { provider: 'claude-code', changed: false, path, reason: 'already installed' };
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command: expectedCmd }] });
  writeJson(path, settings);
  return { provider: 'claude-code', changed: true, path };
}

export function ensureGeminiHook({ home = homedir(), hookScript = DEFAULT_HOOK_SCRIPT } = {}) {
  const path = join(home, '.gemini', 'settings.json');
  const settings = readJson(path);
  const expectedCmd = `node ${hookScript} --provider gemini-cli`;
  settings.hooks ??= {};
  settings.hooks.AfterAgent ??= [];
  const installed = settings.hooks.AfterAgent.some((entry) =>
    Array.isArray(entry?.hooks) && entry.hooks.some((h) => h?.type === 'command' && h?.command === expectedCmd),
  );
  if (installed) return { provider: 'gemini-cli', changed: false, path, reason: 'already installed' };
  settings.hooks.AfterAgent.push({ matcher: '*', hooks: [{ type: 'command', command: expectedCmd }] });
  writeJson(path, settings);
  return { provider: 'gemini-cli', changed: true, path };
}

export function ensureCodexHook({ home = homedir(), hookScript = DEFAULT_HOOK_SCRIPT } = {}) {
  const path = join(home, '.codex', 'config.toml');
  if (!existsSync(path)) {
    return { provider: 'codex', changed: false, path, reason: 'config.toml not found — install codex first' };
  }
  const original = readFileSync(path, 'utf8');
  const expectedNotify = `notify = ["node", "${hookScript}", "--provider", "codex", "--notify-json-arg"]`;
  const lineRegex = /^notify\s*=\s*\[.*\]\s*$/m;
  const hasLine = lineRegex.test(original);
  const matches = hasLine && original.match(lineRegex)[0].trim() === expectedNotify;
  if (matches) return { provider: 'codex', changed: false, path, reason: 'already installed' };

  let updated;
  if (hasLine) {
    updated = original.replace(lineRegex, expectedNotify);
  } else {
    const sectionMatch = original.match(/^\[/m);
    updated = sectionMatch
      ? original.slice(0, sectionMatch.index) + expectedNotify + '\n' + original.slice(sectionMatch.index)
      : expectedNotify + '\n' + original;
  }
  writeFileSync(path, updated, 'utf8');
  return { provider: 'codex', changed: true, path };
}
