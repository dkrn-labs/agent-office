import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SETTINGS_FILE = 'settings.json';

/**
 * User-facing settings — separate from `config.json` (which holds internal
 * state like projectsDir + skill roots + garden schedules). settings.json
 * is the operator's knob-board: port to bind, daily $ cap, per-provider
 * toggles, and the frontdesk LLM stage feature flag.
 *
 * P1-11 ships these four sections; later phases extend the schema (e.g.
 * P2 turns on frontdesk.llm; P3 adds providers.local.* for Ollama).
 *
 * The file is optional. When missing, defaults below apply.
 *
 * @returns {object}
 */
export function getDefaultSettings() {
  return {
    version: 1,
    core: {
      port: 3334,
    },
    user: {
      // null = no cap. Numeric value is interpreted as USD/day across all
      // providers; the savings ledger is the truth source the cap reads from.
      dailyDollarCap: null,
    },
    providers: {
      'claude-code': { enabled: true },
      codex: { enabled: true },
      'gemini-cli': { enabled: true },
    },
    frontdesk: {
      // P1 ships rules-only routing. P2 flips this to true and wires
      // src/frontdesk/llm.js as a second-stage reasoner.
      llm: { enabled: false },
    },
  };
}

function deepMerge(defaults, overrides) {
  if (overrides == null) return defaults;
  const out = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const dv = defaults[key];
    const ov = overrides[key];
    if (dv && typeof dv === 'object' && !Array.isArray(dv) && ov && typeof ov === 'object' && !Array.isArray(ov)) {
      out[key] = deepMerge(dv, ov);
    } else if (ov !== undefined) {
      out[key] = ov;
    }
  }
  return out;
}

/**
 * Load settings from `<dataDir>/settings.json`, deep-merged onto defaults.
 * Missing file = defaults; unreadable / malformed file = defaults + a console
 * warning (we don't crash the server on a typo'd settings file).
 *
 * @param {string} dataDir
 * @returns {object}
 */
export function loadSettings(dataDir) {
  const defaults = getDefaultSettings();
  const filePath = join(dataDir, SETTINGS_FILE);
  if (!existsSync(filePath)) return defaults;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return deepMerge(defaults, parsed);
  } catch (err) {
    console.warn(`[settings] failed to read ${filePath}: ${err.message} — falling back to defaults`);
    return defaults;
  }
}

/**
 * Persist settings to `<dataDir>/settings.json`. Creates the data dir if
 * needed. Safe to call with the merged shape returned by `loadSettings`.
 *
 * @param {object} settings
 * @param {string} dataDir
 */
export function saveSettings(settings, dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const filePath = join(dataDir, SETTINGS_FILE);
  writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/**
 * Convenience: list provider IDs enabled in settings. Used by the frontdesk
 * runner to filter the provider candidate set before rule evaluation.
 *
 * @param {object} settings
 * @returns {Set<string>}
 */
export function enabledProviderIds(settings) {
  const map = settings?.providers ?? {};
  return new Set(
    Object.entries(map)
      .filter(([, cfg]) => cfg?.enabled !== false)
      .map(([id]) => id),
  );
}
