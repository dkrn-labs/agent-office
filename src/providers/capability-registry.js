import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

/**
 * Capability registry — single source of truth for "what providers (CLIs +
 * models) does this user have, and what is each one good at".
 *
 * Lifecycle:
 *   1. Package ships `config/provider-capabilities.default.json` with
 *      curated, web-verified vendor strengths.
 *   2. On `agent-office start`, discoverCapabilities() loads defaults,
 *      deep-merges the user file at `<dataDir>/provider-capabilities.json`
 *      (if any), runs CLI presence + version detection, and persists the
 *      merged snapshot back to the user file.
 *   3. The frontdesk prompt builder (Task 13) reads the snapshot to render
 *      enriched provider candidates — fixes the vendor-selection bias the
 *      2026-04-26 experiment surfaced.
 *
 * No network I/O during discovery. The "fact-check on the web" path is a
 * separate `agent-office providers refresh` CLI command (Task 11 ships
 * the stub; auto-refresh deferred to P5).
 */

const STALE_THRESHOLD_DAYS = 14;

function readJsonOrNull(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`[providers] failed to parse ${filePath}: ${err.message}`);
    return null;
  }
}

function deepMerge(base, overrides) {
  if (overrides == null) return base;
  if (base == null) return overrides;
  if (Array.isArray(overrides)) return overrides;          // arrays replace, not merge
  if (typeof base !== 'object' || typeof overrides !== 'object') return overrides;
  const out = { ...base };
  for (const key of Object.keys(overrides)) {
    out[key] = deepMerge(base[key], overrides[key]);
  }
  return out;
}

/**
 * Default binary detector — `which $bin` then `$bin --version` (or whatever
 * `versionCommand` was configured). Tests inject a fake detector so the
 * unit suite stays hermetic.
 *
 * @param {string} binary
 * @returns {Promise<{ found: boolean, path: string|null, version: string|null }>}
 */
async function defaultDetectBinary(binary, versionCommand = ['--version']) {
  let path = null;
  try {
    const which = await execFile('which', [binary], { timeout: 1000 });
    path = which.stdout.trim() || null;
  } catch {
    return { found: false, path: null, version: null };
  }
  let version = null;
  try {
    const v = await execFile(binary, versionCommand, { timeout: 2000 });
    version = (v.stdout || v.stderr).trim().split('\n')[0] || null;
  } catch { /* ignore — present but version probe failed */ }
  return { found: !!path, path, version };
}

/**
 * @param {{
 *   dataDir: string,                      // ~/.agent-office or test temp dir
 *   packageDir: string,                   // package root containing config/
 *   detectBinary?: (bin: string, versionCmd?: string[]) => Promise<{found,path,version}>,
 * }} arg
 * @returns {Promise<object>} the merged + annotated capabilities snapshot
 */
export async function discoverCapabilities({ dataDir, packageDir, detectBinary }) {
  const detect = detectBinary ?? ((bin, vc) => defaultDetectBinary(bin, vc));

  const defaults = readJsonOrNull(join(packageDir, 'config', 'provider-capabilities.default.json'));
  if (!defaults) throw new Error('capability-registry: missing provider-capabilities.default.json');

  const userPath = join(dataDir, 'provider-capabilities.json');
  const userOverrides = readJsonOrNull(userPath);
  const merged = deepMerge(defaults, userOverrides ?? {});

  // CLI presence — runs in parallel.
  await Promise.all(Object.entries(merged.providers ?? {}).map(async ([id, p]) => {
    const binary = p?.cli?.binary;
    if (!binary) {
      p.installed = false;
      p.installedVersion = null;
      p.installedPath = null;
      return;
    }
    const result = await detect(binary, p.cli.versionCommand ?? ['--version']);
    p.installed = !!result.found;
    p.installedVersion = result.version ?? null;
    p.installedPath = result.path ?? null;
  }));

  // Stale warning — based on whichever lastVerifiedAt won the merge (user
  // override wins, otherwise package default).
  const verifiedAt = merged.lastVerifiedAt ? new Date(merged.lastVerifiedAt) : null;
  if (verifiedAt && !Number.isNaN(verifiedAt.getTime())) {
    const ageDays = (Date.now() - verifiedAt.getTime()) / 86_400_000;
    if (ageDays > STALE_THRESHOLD_DAYS) {
      console.warn(`[providers] capabilities last verified ${Math.round(ageDays)} days ago — run \`agent-office providers refresh\` to update`);
    }
  }

  // Persist merged snapshot. Best-effort — failure here doesn't crash boot.
  try {
    writeFileSync(userPath, JSON.stringify(merged, null, 2) + '\n');
  } catch (err) {
    console.warn(`[providers] failed to persist merged snapshot to ${userPath}: ${err.message}`);
  }

  return merged;
}
