/**
 * Claude Code provider adapter.
 *
 * P1-3 — first reference implementation of ProviderAdapter. The launcher
 * and frontdesk consume only this contract; no `if (provider === 'claude-code')`
 * branches outside of `src/providers/`.
 */

import { computeCostUsd } from '../telemetry/pricing.js';

/** @type {import('./types.js').ProviderAdapter} */
const claudeCodeAdapter = {
  id: 'claude-code',
  label: 'Claude Code',
  kind: 'cloud',
  bin: 'claude',
  defaultModel: 'sonnet',

  capabilities: {
    toolUse: true,
    largeContext: 1_000_000,
    streaming: true,
    visionInput: true,
  },

  modelCatalog: [
    { id: 'sonnet', tier: 'mid', contextWindow: 1_000_000, costInPer1k: 0.003, costOutPer1k: 0.015 },
    { id: 'opus', tier: 'large', contextWindow: 200_000, costInPer1k: 0.015, costOutPer1k: 0.075 },
    { id: 'haiku', tier: 'small', contextWindow: 200_000, costInPer1k: 0.001, costOutPer1k: 0.005 },
    { id: 'claude-sonnet-4-6', tier: 'mid', contextWindow: 1_000_000, costInPer1k: 0.003, costOutPer1k: 0.015 },
    { id: 'claude-opus-4-6', tier: 'large', contextWindow: 200_000, costInPer1k: 0.015, costOutPer1k: 0.075 },
    { id: 'claude-haiku-4-5', tier: 'small', contextWindow: 200_000, costInPer1k: 0.001, costOutPer1k: 0.005 },
  ],

  /**
   * Build the spawn recipe for an interactive Claude Code session.
   * Prompt is delivered via the `--append-system-prompt` flag (delivery='flag');
   * the actual launcher writes the prompt to a temp file and substitutes
   * `"$PROMPT"` at exec time to sidestep shell escaping. The adapter just
   * declares its convention.
   */
  spawn(ctx) {
    const model = ctx.model?.trim() || claudeCodeAdapter.defaultModel;
    const env = { ...ctx.extraEnv };
    if (ctx.historySessionId != null) {
      env.AGENT_OFFICE_HISTORY_SESSION_ID = String(ctx.historySessionId);
    }
    return {
      argv: ['claude', '--model', model, '--append-system-prompt', '$PROMPT'],
      env,
      promptDelivery: 'flag',
      promptFlag: '--append-system-prompt',
      cwd: ctx.projectPath,
    };
  },

  cost(usage, model) {
    // Map short aliases to canonical pricing keys
    const canonical = ({
      sonnet: 'claude-sonnet-4-6',
      opus: 'claude-opus-4-6',
      haiku: 'claude-haiku-4-5',
    })[model] ?? model;
    const dollars = computeCostUsd({
      model: canonical,
      tokensIn: usage.input,
      tokensOut: usage.output,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
    });
    return { dollars: dollars ?? 0 };
  },
};

export default claudeCodeAdapter;
