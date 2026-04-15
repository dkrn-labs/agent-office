import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const CONFIG_FILE = 'config.json';

/**
 * Returns the default configuration object.
 * @returns {object}
 */
export function getDefault() {
  return {
    version: 1,
    projectsDir: join(os.homedir(), 'Projects'),
    port: 3333,
    skillRoots: [join(os.homedir(), '.agents', 'skills')],
    garden: {
      memorySchedule: '0 2 * * 0',
      claudeMdSchedule: '0 3 * * 0',
      defaultMaxTokens: 200000,
      requireApproval: true,
    },
    personaPrompts: {},
  };
}

/**
 * Loads config from configDir/config.json, merging with defaults.
 * If the file does not exist, returns the default config.
 * @param {string} configDir
 * @returns {object}
 */
export function loadConfig(configDir) {
  const filePath = join(configDir, CONFIG_FILE);
  const defaults = getDefault();
  let fromFile = {};
  try {
    const raw = readFileSync(filePath, 'utf8');
    fromFile = JSON.parse(raw);
  } catch {
    // File missing or unreadable — use defaults
    return defaults;
  }
  return {
    ...defaults,
    ...fromFile,
    skillRoots: Array.isArray(fromFile.skillRoots) && fromFile.skillRoots.length > 0
      ? fromFile.skillRoots
      : defaults.skillRoots,
    garden: {
      ...defaults.garden,
      ...(fromFile.garden ?? {}),
    },
    personaPrompts: {
      ...defaults.personaPrompts,
      ...(fromFile.personaPrompts ?? {}),
    },
  };
}

/**
 * Saves config to configDir/config.json, creating the directory if needed.
 * @param {object} config
 * @param {string} configDir
 */
export function saveConfig(config, configDir) {
  mkdirSync(configDir, { recursive: true });
  const filePath = join(configDir, CONFIG_FILE);
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}
