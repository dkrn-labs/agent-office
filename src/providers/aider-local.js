/**
 * Aider-local provider adapter (P3-5).
 *
 * Aider drives any OpenAI-compatible endpoint via the OPENAI_API_BASE
 * env var. Pointing it at LMStudio's `/v1` gives a fully local coding
 * agent with $0 marginal cost. The frontdesk router selects this
 * adapter under R3 (privacyMode=strict) or R4 (daily $ cap reached);
 * the launcher spawns it the same way it spawns any other adapter.
 *
 * Cost shape: `dollars = 0`, `cloudEquivalent` filled vs. claude-sonnet
 * pricing so the savings pill can credit the local routing.
 */

import { computeCostUsd } from '../telemetry/pricing.js';

const DEFAULT_LMSTUDIO_HOST = 'http://localhost:1234';
const DEFAULT_MODEL = 'openai/google/gemma-4-e4b';

/** @type {import('./types.js').ProviderAdapter} */
const aiderLocalAdapter = {
  id: 'aider-local',
  label: 'Aider (local via LMStudio)',
  kind: 'local',
  bin: 'aider',
  defaultModel: DEFAULT_MODEL,

  capabilities: {
    toolUse: true,
    largeContext: 8_192,
    streaming: false,
    visionInput: false,
  },

  modelCatalog: [
    {
      id: DEFAULT_MODEL,
      tier: 'small',
      contextWindow: 8_192,
      costInPer1k: 0,
      costOutPer1k: 0,
    },
  ],

  /**
   * Spawn recipe for an interactive Aider session against LMStudio.
   * `--no-auto-commits` keeps Aider from creating commits behind the
   * user's back; `--yes-always` lets it apply edits without prompting
   * (the operator is already supervising via the xterm.js panel).
   *
   * @param {import('./types.js').LaunchContext & { lmstudioHost?: string }} ctx
   */
  spawn(ctx) {
    const model = ctx.model?.trim() || DEFAULT_MODEL;
    const host = ctx.lmstudioHost?.trim() || DEFAULT_LMSTUDIO_HOST;
    const env = {
      ...ctx.extraEnv,
      // LMStudio's OpenAI-compat endpoint; key is required by aider
      // but not validated by LMStudio.
      OPENAI_API_BASE: `${host}/v1`,
      OPENAI_API_KEY: 'lm-studio',
    };
    if (ctx.historySessionId != null) {
      env.AGENT_OFFICE_HISTORY_SESSION_ID = String(ctx.historySessionId);
    }
    return {
      argv: [
        'aider',
        '--model', model,
        '--no-auto-commits',
        '--yes-always',
        '--message-file', '$PROMPT',
      ],
      env,
      promptDelivery: 'file',
      cwd: ctx.projectPath,
    };
  },

  /**
   * Local sessions always cost $0. `cloudEquivalent` is the sonnet-tier
   * estimate the savings pill credits to local routing.
   */
  cost(usage, _model) {
    const cloudEquivalent = computeCostUsd({
      model: 'claude-sonnet-4-6',
      tokensIn: usage.input ?? 0,
      tokensOut: usage.output ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
    }) ?? 0;
    return { dollars: 0, cloudEquivalent };
  },

  telemetry: {
    sample(sessionId, { repo } = {}) {
      if (!repo || typeof repo.getLaunchBudgetForSession !== 'function') return null;
      const row = repo.getLaunchBudgetForSession(sessionId);
      if (!row) return null;
      return {
        inputTokens: row.tokensInOptimized ?? row.tokensIn ?? 0,
        outputTokens: row.tokensOutOptimized ?? row.tokensOut ?? 0,
        costDollars: row.costDollars ?? 0,
      };
    },
  },

  /** Local has no rate-quota concept. */
  async quota() {
    return null;
  },
};

export default aiderLocalAdapter;
