export const LAUNCH_PROVIDERS = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    promptModeLabel: 'appended to Claude system prompt',
    defaultModel: 'sonnet',
    models: ['sonnet', 'opus', 'claude-sonnet-4-6', 'claude-opus-4-1'],
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
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

export const DEFAULT_LAUNCH_PROVIDER_ID = LAUNCH_PROVIDERS[0].id;

export function getLaunchProviderById(providerId) {
  return (
    LAUNCH_PROVIDERS.find((provider) => provider.id === providerId) ??
    LAUNCH_PROVIDERS[0]
  );
}
