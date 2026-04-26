/**
 * Gemini CLI provider adapter — full contract (P3-3).
 *
 * Same shape as the codex migration. parseTranscript reads a single
 * gemini session-*.json (the watcher already knows how to enumerate
 * project dirs; this method is the recovery path / single-file probe).
 */

import { existsSync, readFileSync } from 'node:fs';
import { ensureGeminiHook } from './hook-installer.js';
import { parseGeminiSession } from '../telemetry/gemini-watcher.js';

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

  async installHook(opts = {}) {
    return ensureGeminiHook(opts);
  },

  /**
   * Parse a single gemini session-*.json transcript. Returns one summary
   * event in the same shape the watcher emits via tracker.updateAbsolute.
   *
   * @param {string} transcriptPath
   * @returns {Array<object>}
   */
  parseTranscript(transcriptPath) {
    if (!transcriptPath || !existsSync(transcriptPath)) return [];
    try {
      // Validate the file is parseable before we delegate.
      JSON.parse(readFileSync(transcriptPath, 'utf8'));
    } catch {
      return [];
    }
    const session = parseGeminiSession(transcriptPath);
    if (!session?.providerSessionId) return [];
    return [{ providerId: 'gemini-cli', ...session }];
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

  async quota() {
    return null;
  },
};

export default geminiCliAdapter;
