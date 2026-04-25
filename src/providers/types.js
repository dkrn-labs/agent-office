/**
 * Provider Adapter contract — the single extensibility seam for any CLI
 * coding agent (cloud or local) that agent-office supports.
 *
 * Every adapter exports a default object that satisfies this contract.
 * Launcher, frontdesk, savings-ledger, and the UI consume only the
 * contract — never branch on `providerId === 'claude-code'` or similar
 * outside of `src/providers/`.
 *
 * Documented in detail in docs/architecture/agent-commander.md §5.
 */

// ─── JSDoc typedefs ─────────────────────────────────────────────────────────

/**
 * @typedef {'cloud'|'local'} ProviderKind
 *
 * @typedef {object} LaunchContext
 * @property {string} projectPath              Absolute path; spawned cwd
 * @property {string} systemPrompt             Already-assembled prompt text
 * @property {string} [model]                  Specific model id; adapter falls back to default
 * @property {number|null} [historySessionId]  Set by launcher pre-create; bridged to hook via env
 * @property {Record<string, string>} [extraEnv]
 *
 * @typedef {object} SpawnRecipe
 * @property {string[]} argv                   Full argv (incl. binary at [0])
 * @property {Record<string, string>} env      Env vars to set on spawn (incl. AGENT_OFFICE_HISTORY_SESSION_ID)
 * @property {'stdin'|'file'|'flag'} promptDelivery
 * @property {string} [promptFlag]             When promptDelivery === 'flag'; CLI arg name (e.g. '--append-system-prompt')
 * @property {string} cwd
 *
 * @typedef {object} QuotaWindow
 * @property {{ used: number, limit: number, resetAt: string }} fivehour
 * @property {{ used: number, limit: number, resetAt: string }} sevenday
 *
 * @typedef {object} LiveSample
 * @property {number} pid
 * @property {number} contextPct
 * @property {number} tokensIn
 * @property {number} tokensOut
 * @property {number} cacheRead
 * @property {number} cacheWrite
 * @property {string} model
 * @property {number} turn
 * @property {number} memoryMB
 *
 * @typedef {object} Usage
 * @property {number} input
 * @property {number} output
 * @property {number} [cacheRead]
 * @property {number} [cacheWrite]
 *
 * @typedef {object} CostBreakdown
 * @property {number} dollars                   0 for local
 * @property {number} [cloudEquivalent]         What this would have cost on a cloud peer
 * @property {number} [energyWh]                Optional, for local
 *
 * @typedef {object} ModelCatalogEntry
 * @property {string} id
 * @property {'small'|'mid'|'large'} tier
 * @property {number} contextWindow
 * @property {number} costInPer1k                $/1k input tokens (0 for local)
 * @property {number} costOutPer1k               $/1k output tokens (0 for local)
 *
 * @typedef {object} ProviderCapabilities
 * @property {boolean} toolUse
 * @property {number} largeContext               Max context window across this provider's models
 * @property {boolean} streaming
 * @property {boolean} visionInput
 *
 * @typedef {object} ProviderAdapter
 * @property {string} id                        Stable identifier — 'claude-code', 'ollama-aider', etc.
 * @property {string} label                     Human-readable
 * @property {ProviderKind} kind
 * @property {string} bin                       Resolved via PATH at boot
 * @property {string} defaultModel
 * @property {ProviderCapabilities} capabilities
 * @property {ModelCatalogEntry[]} modelCatalog
 *
 * @property {(ctx: LaunchContext) => SpawnRecipe} spawn   REQUIRED — build the spawn recipe
 * @property {(usage: Usage, model: string) => CostBreakdown} cost   REQUIRED — compute $ per usage record
 *
 * @property {() => Promise<void>} [installHook]           Idempotent post-session hook installer
 * @property {(transcriptPath: string) => any[]} [parseTranscript]   Fallback when hook misses
 * @property {{ sample: (pid: number) => Promise<LiveSample|null> }} [telemetry]
 * @property {() => Promise<QuotaWindow|null>} [quota]     null for local
 */

/**
 * Validate an adapter at registration time. Throws with a useful message if
 * required fields are missing or wrong-typed. Pure — no side effects.
 *
 * @param {ProviderAdapter} adapter
 * @returns {void}
 */
export function assertValidAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('adapter must be an object');
  const required = ['id', 'label', 'kind', 'bin', 'defaultModel', 'capabilities', 'modelCatalog', 'spawn', 'cost'];
  for (const key of required) {
    if (adapter[key] == null) {
      throw new Error(`adapter ${adapter.id ?? '?'}: missing required field "${key}"`);
    }
  }
  if (typeof adapter.spawn !== 'function') throw new Error(`adapter ${adapter.id}: spawn must be a function`);
  if (typeof adapter.cost !== 'function') throw new Error(`adapter ${adapter.id}: cost must be a function`);
  if (adapter.kind !== 'cloud' && adapter.kind !== 'local') {
    throw new Error(`adapter ${adapter.id}: kind must be 'cloud' or 'local'`);
  }
  if (!Array.isArray(adapter.modelCatalog) || adapter.modelCatalog.length === 0) {
    throw new Error(`adapter ${adapter.id}: modelCatalog must be a non-empty array`);
  }
}
