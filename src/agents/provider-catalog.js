const PROVIDERS = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    promptMode: 'append-system-prompt',
    promptModeLabel: 'appended to Claude system prompt',
    defaultModel: 'sonnet',
    models: ['sonnet', 'opus', 'claude-sonnet-4-6', 'claude-opus-4-1'],
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    promptMode: 'initial-prompt',
    promptModeLabel: 'sent as Codex bootstrap prompt',
    defaultModel: 'gpt-5.4',
    models: [
      'gpt-5.4',
      'gpt-5.2-codex',
      'gpt-5.1-codex-max',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.2',
      'gpt-5.1-codex-mini',
    ],
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    command: 'gemini',
    promptMode: 'prompt-interactive',
    promptModeLabel: 'sent as Gemini interactive prompt',
    defaultModel: 'gemini-3-flash-preview',
    models: [
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
  },
];

const PROVIDER_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export const DEFAULT_PROVIDER_ID = PROVIDERS[0].id;

export function listLaunchProviders() {
  return PROVIDERS.map((provider) => ({
    ...provider,
    models: [...provider.models],
  }));
}

export function resolveLaunchTarget(providerId, model) {
  const provider = PROVIDER_BY_ID.get(providerId) ?? PROVIDER_BY_ID.get(DEFAULT_PROVIDER_ID);
  const candidateModel = typeof model === 'string' ? model.trim() : '';

  return {
    providerId: provider.id,
    label: provider.label,
    command: provider.command,
    promptMode: provider.promptMode,
    promptModeLabel: provider.promptModeLabel,
    model: candidateModel || provider.defaultModel,
    defaultModel: provider.defaultModel,
    models: [...provider.models],
  };
}
