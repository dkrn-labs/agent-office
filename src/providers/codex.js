/**
 * Codex provider adapter — full contract (P3-2).
 *
 * Exposes the four contract methods in addition to spawn/cost:
 *   - installHook   — idempotent write of `notify = [...]` into ~/.codex/config.toml
 *   - parseTranscript — read recent thread rows from state_5.sqlite (recovery
 *                       path when the watcher has been down or for cold-start backfill)
 *   - telemetry.sample — read persisted launch_budget for a session id
 *   - quota — null until the abtop bridge ships real signals in P4
 */

import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { ensureCodexHook } from './hook-installer.js';

function toIsoFromEpochSeconds(value) {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return new Date(num * 1000).toISOString();
}

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

  /**
   * Idempotent. Writes the notify-line into ~/.codex/config.toml.
   * Caller can override `home` and `hookScript` for testing.
   */
  async installHook(opts = {}) {
    return ensureCodexHook(opts);
  },

  /**
   * Read recent thread rows from state_5.sqlite. Used as a recovery path
   * when the watcher poll has been down — emits the same shape the
   * watcher would have produced via tracker.updateAbsolute.
   *
   * @param {string} stateDbPath  Path to ~/.codex/state_5.sqlite
   * @returns {Array<object>}
   */
  parseTranscript(stateDbPath) {
    if (!stateDbPath || !existsSync(stateDbPath)) return [];
    let db;
    try {
      db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
      const rows = db.prepare(`
        SELECT id, cwd, model, tokens_used, updated_at
        FROM threads
        ORDER BY updated_at DESC
        LIMIT 100
      `).all();
      return rows.map((row) => {
        const total = Number(row.tokens_used ?? 0);
        return {
          providerId: 'codex',
          providerSessionId: row.id,
          projectPath: row.cwd,
          lastModel: row.model ?? null,
          lastActivity: toIsoFromEpochSeconds(row.updated_at),
          totals: { tokensIn: total, tokensOut: 0, cacheRead: 0, cacheWrite: 0, total },
        };
      });
    } catch {
      return [];
    } finally {
      db?.close?.();
    }
  },

  telemetry: {
    /**
     * Read the persisted launch_budget row for a session id. Until the
     * abtop bridge ships (P4), this is the closest agent-office has to
     * a "telemetry sample" — the row is written by the post-session
     * hook + watcher pipeline.
     *
     * @param {number|string} sessionId
     * @param {{ repo: object }} deps
     * @returns {{ inputTokens: number, outputTokens: number, costDollars: number }|null}
     */
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

  /**
   * Real quota signals land in P4 with the abtop --rpc bridge
   * (issue #0002). Returning null tells the rules engine "no quota
   * data" so R5/R6 (over-quota drop / demote) skip codex by default.
   */
  async quota() {
    return null;
  },
};

export default codexAdapter;
