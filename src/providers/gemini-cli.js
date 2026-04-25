/**
 * Gemini CLI provider adapter — minimal P1 implementation.
 *
 * Full migration (parseTranscript, telemetry sample, hook installer
 * delegation) lands in P3-2.
 */

/** @type {import('./types.js').ProviderAdapter} */
const geminiCliAdapter = {
  id: 'gemini-cli',
  label: 'Gemini CLI',
  kind: 'cloud',
  bin: 'gemini',
  defaultModel: 'gemini-3-flash-preview',

  capabilities: {
    toolUse: true,
    largeContext: 1_000_000,
    streaming: true,
    visionInput: true,
  },

  modelCatalog: [
    { id: 'gemini-3-flash-preview', tier: 'mid', contextWindow: 1_000_000, costInPer1k: 0.0005, costOutPer1k: 0.0025 },
    { id: 'gemini-3.1-flash-lite-preview', tier: 'small', contextWindow: 1_000_000, costInPer1k: 0.0001, costOutPer1k: 0.0004 },
    { id: 'gemini-2.5-flash', tier: 'mid', contextWindow: 1_000_000, costInPer1k: 0.0003, costOutPer1k: 0.0025 },
    { id: 'gemini-2.5-flash-lite', tier: 'small', contextWindow: 1_000_000, costInPer1k: 0.0001, costOutPer1k: 0.0004 },
  ],

  /**
   * Gemini interactive mode takes the prompt via `--prompt-interactive`.
   * Same `$PROMPT` substitution convention as the other adapters.
   */
  spawn(ctx) {
    const model = ctx.model?.trim() || geminiCliAdapter.defaultModel;
    const env = { ...ctx.extraEnv };
    if (ctx.historySessionId != null) {
      env.AGENT_OFFICE_HISTORY_SESSION_ID = String(ctx.historySessionId);
    }
    return {
      argv: ['gemini', '--model', model, '--prompt-interactive', '$PROMPT'],
      env,
      promptDelivery: 'flag',
      promptFlag: '--prompt-interactive',
      cwd: ctx.projectPath,
    };
  },

  cost(usage, model) {
    const entry = geminiCliAdapter.modelCatalog.find((m) => m.id === model);
    if (!entry) return { dollars: 0 };
    const dollars =
      (usage.input / 1000) * entry.costInPer1k +
      (usage.output / 1000) * entry.costOutPer1k;
    return { dollars };
  },
};

export default geminiCliAdapter;
