/**
 * Codex provider adapter — minimal P1 implementation.
 *
 * Full migration (parseTranscript reading logs_2.sqlite, telemetry sample,
 * watcher/hook session-id merge per Task #16) lands in P3-1.
 */

/** @type {import('./types.js').ProviderAdapter} */
const codexAdapter = {
  id: 'codex',
  label: 'Codex',
  kind: 'cloud',
  bin: 'codex',
  defaultModel: 'gpt-5.4',

  capabilities: {
    toolUse: true,
    largeContext: 200_000,
    streaming: true,
    visionInput: false,
  },

  modelCatalog: [
    { id: 'gpt-5.4', tier: 'large', contextWindow: 200_000, costInPer1k: 0.005, costOutPer1k: 0.020 },
    { id: 'gpt-5.4-mini', tier: 'mid', contextWindow: 200_000, costInPer1k: 0.0015, costOutPer1k: 0.006 },
    { id: 'gpt-5.2-codex', tier: 'mid', contextWindow: 200_000, costInPer1k: 0.0025, costOutPer1k: 0.010 },
    { id: 'gpt-5.1-codex-max', tier: 'large', contextWindow: 200_000, costInPer1k: 0.005, costOutPer1k: 0.020 },
    { id: 'gpt-5.1-codex-mini', tier: 'small', contextWindow: 200_000, costInPer1k: 0.0008, costOutPer1k: 0.003 },
  ],

  /**
   * Codex takes the prompt as a positional bootstrap argument. The launcher
   * replaces `$PROMPT` with the contents of a temp file at exec time.
   */
  spawn(ctx) {
    const model = ctx.model?.trim() || codexAdapter.defaultModel;
    const env = { ...ctx.extraEnv };
    if (ctx.historySessionId != null) {
      env.AGENT_OFFICE_HISTORY_SESSION_ID = String(ctx.historySessionId);
    }
    return {
      argv: ['codex', '--model', model, '$PROMPT'],
      env,
      promptDelivery: 'flag',
      cwd: ctx.projectPath,
    };
  },

  cost(usage, model) {
    const entry = codexAdapter.modelCatalog.find((m) => m.id === model);
    if (!entry) return { dollars: 0 };
    const dollars =
      (usage.input / 1000) * entry.costInPer1k +
      (usage.output / 1000) * entry.costOutPer1k;
    return { dollars };
  },
};

export default codexAdapter;
