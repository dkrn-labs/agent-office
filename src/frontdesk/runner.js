/**
 * Frontdesk runner — walks the rule chain and emits a Candidates object
 * that the wizard's Pre-fill button consumes. Pure: no I/O.
 *
 * The state-assembly entry point is `route()`, which gathers ao-core
 * state (personas, providers, active sessions, prefs) and passes the
 * shaped state into `runRules()`.
 */

import { RULES } from './rules.js';
import { listAdapters, DEFAULT_PROVIDER_ID } from '../providers/manifest.js';

/**
 * @typedef {object} Candidates
 * @property {Array} personas
 * @property {Array} providers
 * @property {{ mustBeLocal?: boolean, mustBeLocalReason?: string, attachTo?: object|null, blockedReason?: string|null }} constraints
 * @property {string[]} rulesApplied
 */

/**
 * Apply every rule in order; return the final Candidates.
 *
 * @param {object} state
 * @param {string} task
 * @param {Candidates} initial
 */
export function runRules(state, task, initial) {
  let cands = initial;
  for (const rule of RULES) {
    cands = rule.apply(state, task, cands);
  }
  return cands;
}

/**
 * Top-level: gather state from the host, run rules, return a Proposal
 * shape ready for the wizard.
 *
 * @param {{
 *   repo: object,
 *   getActiveSessions?: () => Array,
 *   getQuotaForProvider?: (providerId: string) => Promise<number|null>,
 *   prefs?: object,
 *   signals?: { hasRecentDiffOrPr?: boolean }
 * }} deps
 * @param {{ task: string }} input
 */
export async function route({ repo, getActiveSessions, getQuotaForProvider, prefs, signals }, input) {
  const task = String(input?.task ?? '').trim();
  if (!task) {
    return { error: 'task is required', candidates: null };
  }

  // Gather state
  const personas = typeof repo?.listPersonas === 'function' ? repo.listPersonas() : [];
  const projects = typeof repo?.listProjects === 'function' ? repo.listProjects() : [];
  const adapters = listAdapters();
  // P1-11 — filter to providers enabled in settings.json. When prefs
  // doesn't carry an enabled-set (e.g. tests calling route() directly),
  // every adapter is admitted.
  const enabled = prefs?.enabledProviders;
  const allowedAdapters = enabled instanceof Set
    ? adapters.filter((a) => enabled.has(a.id))
    : adapters;
  const providers = await Promise.all(allowedAdapters.map(async (a) => ({
    id: a.id,
    label: a.label,
    kind: a.kind,
    quotaPct: typeof getQuotaForProvider === 'function'
      ? (await getQuotaForProvider(a.id).catch(() => null)) ?? null
      : null,
  })));
  const activeSessions = typeof getActiveSessions === 'function' ? getActiveSessions() : [];

  const state = {
    personas,
    projects,
    activeSessions,
    prefs: prefs ?? {},
    signals: signals ?? {},
  };

  // Initial unfiltered candidate set
  const initial = {
    personas: [...personas],
    providers: [...providers],
    constraints: { mustBeLocal: false, attachTo: null, blockedReason: null },
    rulesApplied: [],
  };

  const candidates = runRules(state, task, initial);

  return {
    task,
    candidates,
    // Convenience picks for UIs that can't pick themselves yet — first of each
    // narrowed set; null when blocked or no candidates remain.
    pick: candidates.constraints?.blockedReason
      ? null
      : {
          persona: candidates.personas[0] ?? null,
          provider: candidates.providers.find((p) => !candidates.constraints?.mustBeLocal || p.kind === 'local')
                  ?? candidates.providers[0]
                  ?? null,
        },
  };
}

/**
 * Default ad-hoc factory for spinning up a route() with sensible no-ops
 * when the host doesn't supply quota/active-session getters.
 */
export function createRouter({ repo, getActiveSessions, getQuotaForProvider, prefs, signals } = {}) {
  return {
    route: (input) => route({ repo, getActiveSessions, getQuotaForProvider, prefs, signals }, input),
  };
}

// Re-export default provider id for callers
export { DEFAULT_PROVIDER_ID };
