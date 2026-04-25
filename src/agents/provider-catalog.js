/**
 * Legacy provider-catalog facade. Internally delegates to the
 * ProviderAdapter manifest at src/providers/. Kept as a stable export
 * for callers (launcher.prepareLaunch return shape, UI provider
 * picker) until they migrate to consume the adapter contract directly.
 */

import { getAdapter, listAdapters, DEFAULT_PROVIDER_ID as MANIFEST_DEFAULT } from '../providers/manifest.js';

export const DEFAULT_PROVIDER_ID = MANIFEST_DEFAULT;

export function listLaunchProviders() {
  return listAdapters().map((a) => ({
    id: a.id,
    label: a.label,
    command: a.bin,
    // promptMode + promptModeLabel were UI-facing strings; preserve them
    // until the UI moves to consume adapter capabilities directly.
    promptMode: providerPromptMode(a.id),
    promptModeLabel: providerPromptModeLabel(a.id),
    defaultModel: a.defaultModel,
    models: a.modelCatalog.map((m) => m.id),
  }));
}

export function resolveLaunchTarget(providerId, model) {
  const adapter = getAdapter(providerId);
  const candidateModel = typeof model === 'string' ? model.trim() : '';
  return {
    providerId: adapter.id,
    label: adapter.label,
    command: adapter.bin,
    promptMode: providerPromptMode(adapter.id),
    promptModeLabel: providerPromptModeLabel(adapter.id),
    model: candidateModel || adapter.defaultModel,
    defaultModel: adapter.defaultModel,
    models: adapter.modelCatalog.map((m) => m.id),
  };
}

// Prompt mode labels are presentation-only and live here until the UI
// is ready to render this from adapter capabilities.
function providerPromptMode(id) {
  if (id === 'claude-code') return 'append-system-prompt';
  if (id === 'codex') return 'initial-prompt';
  if (id === 'gemini-cli') return 'prompt-interactive';
  return 'append-system-prompt';
}

function providerPromptModeLabel(id) {
  if (id === 'claude-code') return 'appended to Claude system prompt';
  if (id === 'codex') return 'sent as Codex bootstrap prompt';
  if (id === 'gemini-cli') return 'sent as Gemini interactive prompt';
  return 'appended to system prompt';
}
