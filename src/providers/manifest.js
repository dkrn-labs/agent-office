/**
 * Provider adapter registry.
 *
 * Adding a new CLI agent (Aider, Goose, Ollama-Aider, Crush, …) is a
 * single-file drop-in: implement the ProviderAdapter contract and add
 * the import here.
 */

import { assertValidAdapter } from './types.js';
import claudeCode from './claude-code.js';
import codex from './codex.js';
import geminiCli from './gemini-cli.js';

const ADAPTERS = [claudeCode, codex, geminiCli];

// Validate all adapters at module-load time so misregistrations are loud.
for (const adapter of ADAPTERS) {
  assertValidAdapter(adapter);
}

const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

export const DEFAULT_PROVIDER_ID = ADAPTERS[0].id;

/**
 * Get a registered adapter by id. Returns the default when the id is
 * unknown — never null — so callers can rely on a non-null result.
 *
 * @param {string|null|undefined} providerId
 * @returns {import('./types.js').ProviderAdapter}
 */
export function getAdapter(providerId) {
  if (providerId && BY_ID.has(providerId)) return BY_ID.get(providerId);
  return BY_ID.get(DEFAULT_PROVIDER_ID);
}

/**
 * @returns {import('./types.js').ProviderAdapter[]}
 */
export function listAdapters() {
  return [...ADAPTERS];
}

/**
 * Convenience: list as plain objects suitable for the UI's provider picker.
 * Mirrors the shape of the legacy `listLaunchProviders()` so callers can
 * migrate without UI changes.
 */
export function listProvidersForUi() {
  return ADAPTERS.map((a) => ({
    id: a.id,
    label: a.label,
    command: a.bin,
    kind: a.kind,
    defaultModel: a.defaultModel,
    models: a.modelCatalog.map((m) => m.id),
  }));
}
