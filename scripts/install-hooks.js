#!/usr/bin/env node
/**
 * Idempotent installer for agent-office post-session hooks.
 *
 * Adds the provider-history-hook entry to each provider's settings file:
 *   - ~/.claude/settings.json   → Stop hook
 *   - ~/.gemini/settings.json   → AfterAgent hook
 *   - ~/.codex/config.toml      → notify = [...] line
 *
 * Re-runnable. Reads existing settings, only adds the hook entry if
 * missing, never overwrites unrelated keys.
 *
 * Usage:
 *   node scripts/install-hooks.js               # all providers
 *   node scripts/install-hooks.js --only claude
 *   node scripts/install-hooks.js --dry-run     # report what would change
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_SCRIPT = join(REPO_ROOT, 'scripts', 'provider-history-hook.js');

function parseArgs(argv) {
  const out = { only: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') out.only = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`failed to parse ${path}: ${err.message}`);
  }
}

function writeJson(path, data, dryRun) {
  if (dryRun) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return true;
}

function ensureClaude(dryRun) {
  const path = join(homedir(), '.claude', 'settings.json');
  const settings = readJson(path);
  const expectedCmd = `node ${HOOK_SCRIPT} --provider claude-code`;
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];
  const alreadyInstalled = settings.hooks.Stop.some((entry) =>
    Array.isArray(entry?.hooks) &&
    entry.hooks.some((h) => h?.type === 'command' && h?.command === expectedCmd),
  );
  if (alreadyInstalled) return { provider: 'claude-code', changed: false, path, reason: 'already installed' };
  settings.hooks.Stop.push({
    hooks: [{ type: 'command', command: expectedCmd }],
  });
  const wrote = writeJson(path, settings, dryRun);
  return { provider: 'claude-code', changed: true, written: wrote, path };
}

function ensureGemini(dryRun) {
  const path = join(homedir(), '.gemini', 'settings.json');
  const settings = readJson(path);
  const expectedCmd = `node ${HOOK_SCRIPT} --provider gemini-cli`;
  settings.hooks ??= {};
  settings.hooks.AfterAgent ??= [];
  const alreadyInstalled = settings.hooks.AfterAgent.some((entry) =>
    Array.isArray(entry?.hooks) &&
    entry.hooks.some((h) => h?.type === 'command' && h?.command === expectedCmd),
  );
  if (alreadyInstalled) return { provider: 'gemini-cli', changed: false, path, reason: 'already installed' };
  settings.hooks.AfterAgent.push({
    matcher: '*',
    hooks: [{ type: 'command', command: expectedCmd }],
  });
  const wrote = writeJson(path, settings, dryRun);
  return { provider: 'gemini-cli', changed: true, written: wrote, path };
}

function ensureCodex(dryRun) {
  const path = join(homedir(), '.codex', 'config.toml');
  if (!existsSync(path)) {
    return { provider: 'codex', changed: false, path, reason: 'config.toml not found — install codex first' };
  }
  const original = readFileSync(path, 'utf8');
  const expectedNotify = `notify = ["node", "${HOOK_SCRIPT}", "--provider", "codex", "--notify-json-arg"]`;
  const lineRegex = /^notify\s*=\s*\[.*\]\s*$/m;
  const hasLine = lineRegex.test(original);
  const matches = hasLine && original.match(lineRegex)[0].trim() === expectedNotify;
  if (matches) return { provider: 'codex', changed: false, path, reason: 'already installed' };

  let updated;
  if (hasLine) {
    updated = original.replace(lineRegex, expectedNotify);
  } else {
    // Insert before the first [section] header, or append at top
    const sectionMatch = original.match(/^\[/m);
    if (sectionMatch) {
      const idx = sectionMatch.index;
      updated = original.slice(0, idx) + expectedNotify + '\n' + original.slice(idx);
    } else {
      updated = expectedNotify + '\n' + original;
    }
  }
  if (!dryRun) writeFileSync(path, updated, 'utf8');
  return { provider: 'codex', changed: true, written: !dryRun, path };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = args.only ? [args.only] : ['claude-code', 'gemini-cli', 'codex'];
  const handlers = {
    'claude-code': ensureClaude,
    'gemini-cli': ensureGemini,
    codex: ensureCodex,
  };

  console.log(`[install-hooks] hook script: ${HOOK_SCRIPT}`);
  if (args.dryRun) console.log('[install-hooks] dry-run mode — no files will be written');

  let any = false;
  for (const id of targets) {
    const fn = handlers[id];
    if (!fn) {
      console.error(`[install-hooks] unknown provider: ${id}`);
      process.exit(1);
    }
    try {
      const result = fn(args.dryRun);
      const tag = result.changed ? (args.dryRun ? 'WOULD ADD' : 'INSTALLED') : 'SKIP';
      console.log(`  ${tag.padEnd(12)} ${result.provider} → ${result.path}` + (result.reason ? ` (${result.reason})` : ''));
      any ||= result.changed;
    } catch (err) {
      console.error(`  FAILED      ${id}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (!any) console.log('[install-hooks] no changes needed.');
}

main();
