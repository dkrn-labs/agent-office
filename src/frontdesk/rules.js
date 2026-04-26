/**
 * Frontdesk rule chain — deterministic, LLM-independent.
 *
 * Each rule is a pure function `apply(state, task, candidates) → candidates`.
 * Rules run in order; first match for hard constraints wins, soft rules
 * just prune candidate sets.
 *
 * The full 16-rule canonical chain lives in
 * docs/architecture/agent-commander.md §6.1. P1-7 implements the 10 rules
 * that don't depend on the LLM stage. The remaining 6 (R9–R12, R15, R16)
 * land in P2 alongside the LLM reasoner.
 */

const PII_KEYWORDS = [
  'api_key', 'apikey', 'api key',
  '.env', 'secret', 'secrets',
  'password', 'passwd',
  'access_token', 'access token',
  'private_key', 'private key',
  'aws_secret', 'gcp_credentials',
];

const DEPLOY_VERBS = /\b(deploy(ed|ment|ing|s)?|release(d|s)?|rollback(ed|ing|s)?|publish(ed|ing|es)?)\b/i;
const DEBUG_VERBS = /\b(debug(ged|ging|s)?|fix(ed|ing|es)?|crash(ed|es)?|error|broken|repro(duce|duction)?)\b/i;
const MECHANICAL_VERBS = /\b(rename|format|reformat|prettier|lint|add\s+(a\s+)?comment|remove\s+(a\s+)?comment)\b/i;
const LONG_RUNNING_PHRASES = /\b(across the (entire )?codebase|refactor\s+.+?\s+to\s+\S+|migrate\s+.+?\s+to\s+\S+)\b/i;
const SHORT_TASK_CHARS = 60;
const LONG_TASK_CHARS = 500;
const HISTORY_SCORE_FLOOR = 0.4;
const HISTORY_TOKEN_CAP = 12000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function lower(text) {
  return typeof text === 'string' ? text.toLowerCase() : '';
}

function withApplied(candidates, ruleId) {
  return { ...candidates, rulesApplied: [...candidates.rulesApplied, ruleId] };
}

function setConstraint(candidates, fields) {
  return { ...candidates, constraints: { ...candidates.constraints, ...fields } };
}

// ─── Rules ──────────────────────────────────────────────────────────────────

/**
 * R1 — active session matches the task's likely persona+project. Propose
 * attach instead of launch.
 *
 * Heuristic: if the task contains a verbatim project name AND there's an
 * active session for that project, suggest attach.
 */
function R1_active_session_attach(state, task, candidates) {
  const t = lower(task);
  const matchSession = (state.activeSessions ?? []).find((s) => {
    const proj = state.projects?.find((p) => p.id === s.projectId);
    return proj && t.includes(lower(proj.name));
  });
  if (!matchSession) return candidates;
  const updated = setConstraint(candidates, { attachTo: matchSession });
  return withApplied(updated, 'R1');
}

/** R2 — secrets/PII keywords in task → must run on a local provider. */
function R2_secret_keywords_force_local(state, task, candidates) {
  const t = lower(task);
  if (!PII_KEYWORDS.some((kw) => t.includes(kw))) return candidates;
  return withApplied(setConstraint(candidates, { mustBeLocal: true, mustBeLocalReason: 'task contains secrets/PII keywords' }), 'R2');
}

/** R3 — user pref `privacyMode = strict` → must run local. */
function R3_privacy_mode_force_local(state, _task, candidates) {
  if (state.prefs?.privacyMode !== 'strict') return candidates;
  return withApplied(setConstraint(candidates, { mustBeLocal: true, mustBeLocalReason: 'privacyMode=strict' }), 'R3');
}

/** R4 — today's spend at/over daily cap → must run local. */
function R4_daily_cap_force_local(state, _task, candidates) {
  const cap = state.prefs?.dailyDollarCap;
  const spent = state.prefs?.todaySpendDollars;
  if (typeof cap !== 'number' || cap <= 0 || typeof spent !== 'number') return candidates;
  if (spent < cap) return candidates;
  return withApplied(setConstraint(candidates, { mustBeLocal: true, mustBeLocalReason: `daily cap reached ($${spent.toFixed(2)} / $${cap.toFixed(2)})` }), 'R4');
}

/** R5 — drop providers whose 5h or 7d quota window is > 95%. */
function R5_drop_quota_exhausted(state, _task, candidates) {
  const before = candidates.providers.length;
  const filtered = candidates.providers.filter((p) => (p.quotaPct ?? 0) <= 0.95);
  if (filtered.length === before) return candidates;
  return withApplied({ ...candidates, providers: filtered }, 'R5');
}

/** R6 — demote (don't drop) providers in the 80–95% quota band. */
function R6_demote_quota_yellow(state, _task, candidates) {
  let touched = false;
  const providers = candidates.providers.map((p) => {
    const q = p.quotaPct ?? 0;
    if (q >= 0.80 && q <= 0.95) {
      touched = true;
      return { ...p, demoted: true };
    }
    return p;
  });
  if (!touched) return candidates;
  return withApplied({ ...candidates, providers }, 'R6');
}

/** R7 — `mustBeLocal` is set but no local model is loaded → block launch. */
function R7_block_local_unavailable(state, _task, candidates) {
  if (!candidates.constraints?.mustBeLocal) return candidates;
  if (state.prefs?.localModelLoaded) return candidates;
  return withApplied(setConstraint(candidates, { blockedReason: 'mustBeLocal but no local model is loaded — load one (e.g. `ollama pull llama3.1:70b`) before launching' }), 'R7');
}

/** R8 — task verbs deploy/release/rollback → restrict to devops persona. */
function R8_restrict_devops_verbs(state, task, candidates) {
  if (!DEPLOY_VERBS.test(task)) return candidates;
  const filtered = candidates.personas.filter((p) => p.domain === 'devops');
  if (filtered.length === 0) return candidates; // no devops persona — leave personas alone rather than empty out
  return withApplied({ ...candidates, personas: filtered }, 'R8');
}

/**
 * R9 — debug-verb bias. Stable-sort the persona list so the debug persona
 * goes first when the task language signals a bug hunt. Distinct from R8
 * (which *restricts* on deploy verbs); R9 only reorders.
 */
function R9_debug_verb_bias(state, task, candidates) {
  if (!DEBUG_VERBS.test(task)) return candidates;
  const personas = [...candidates.personas].sort((a, b) =>
    domainPriority(a, 'debug') - domainPriority(b, 'debug'));
  return withApplied({ ...candidates, personas }, 'R9');
}

/**
 * R10 — short task with mechanical verbs → tag taskType='oneshot'. The
 * launcher uses this hint to prefer cheap/local providers and skip the
 * heavy context-prefill path.
 */
function R10_oneshot_tag(state, task, candidates) {
  const text = String(task ?? '');
  if (text.length > SHORT_TASK_CHARS) return candidates;
  if (!MECHANICAL_VERBS.test(text)) return candidates;
  return withApplied(setConstraint(candidates, { taskType: 'oneshot' }), 'R10');
}

/**
 * R11 — long-running task tag. Triggers on cross-codebase phrasing,
 * "refactor X to Y" / "migrate X to Y", or task text > 500 chars.
 */
function R11_long_running_tag(state, task, candidates) {
  const text = String(task ?? '');
  const longPhrase = LONG_RUNNING_PHRASES.test(text);
  const longText = text.length > LONG_TASK_CHARS;
  if (!longPhrase && !longText) return candidates;
  return withApplied(setConstraint(candidates, { taskType: 'long-running' }), 'R11');
}

/**
 * R12 — cross-project cache penalty. If the operator's currently
 * cache-warm project doesn't match the project named in the task, mark
 * cacheMiss so the LLM stage can factor in the cost.
 */
function R12_cross_project_cache(state, task, candidates) {
  const currentId = state?.prefs?.currentProjectId;
  if (currentId == null) return candidates;
  const projects = state?.projects ?? [];
  const t = lower(task);
  const named = projects.find((p) => p.name && t.includes(lower(p.name)));
  if (!named || named.id === currentId) return candidates;
  return withApplied(
    setConstraint(candidates, { cacheMiss: true, cacheMissFromProjectId: currentId, cacheMissToProjectId: named.id }),
    'R12',
  );
}

/** R15 — drop history candidates whose score is below the prefill floor. */
function R15_drop_low_score_history(state, _task, candidates) {
  const history = candidates.history ?? [];
  if (!history.length) return candidates;
  const filtered = history.filter((h) => (typeof h.score === 'number' ? h.score : 1) >= HISTORY_SCORE_FLOOR);
  if (filtered.length === history.length) return candidates;
  return withApplied({ ...candidates, history: filtered }, 'R15');
}

/**
 * R16 — trim history when total prefill > 12k tokens. Drops the lowest-
 * score entries first; the highest-score pick is always preserved.
 */
function R16_trim_history(state, _task, candidates) {
  const history = candidates.history ?? [];
  if (!history.length) return candidates;
  const total = history.reduce((acc, h) => acc + (Number(h.tokens) || 0), 0);
  if (total <= HISTORY_TOKEN_CAP) return candidates;

  // Sort descending by score; greedily admit while we still fit.
  const sorted = [...history].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const kept = [];
  let running = 0;
  for (const h of sorted) {
    const cost = Number(h.tokens) || 0;
    if (running + cost > HISTORY_TOKEN_CAP) continue;
    kept.push(h);
    running += cost;
  }
  // Preserve the original order among the kept entries.
  const keptIds = new Set(kept.map((h) => h.id));
  const ordered = history.filter((h) => keptIds.has(h.id));
  return withApplied({ ...candidates, history: ordered }, 'R16');
}

/** R13 — frontdesk and lead are router/coordinator personas; never auto-pick. */
function R13_exclude_router_personas(state, _task, candidates) {
  const before = candidates.personas.length;
  const filtered = candidates.personas.filter((p) => p.domain !== 'router' && p.domain !== 'coordinator' && p.label.toLowerCase() !== 'frontdesk' && p.label.toLowerCase() !== 'tech lead' && p.label.toLowerCase() !== 'lead');
  if (filtered.length === before) return candidates;
  return withApplied({ ...candidates, personas: filtered }, 'R13');
}

/**
 * R14 — review persona is only useful when there's a recent diff/PR to look
 * at. Drop the reviewer when the project hasn't been touched recently.
 */
function R14_drop_review_no_diff(state, _task, candidates) {
  const recentDiff = state.signals?.hasRecentDiffOrPr;
  if (recentDiff !== false) return candidates; // unknown or true → keep
  const filtered = candidates.personas.filter((p) => p.domain !== 'review');
  if (filtered.length === candidates.personas.length) return candidates;
  return withApplied({ ...candidates, personas: filtered }, 'R14');
}

// ─── Soft scoring (not strictly a rule, but the natural follow-up) ──────────

/**
 * Bias the persona list using cheap verb heuristics so the rules-only
 * output is still useful when the LLM stage isn't on. Stable sort: first
 * the persona whose domain matches the dominant verb class, then the rest.
 */
function bias_persona_by_verbs(state, task, candidates) {
  const personas = [...candidates.personas];
  if (DEBUG_VERBS.test(task)) {
    personas.sort((a, b) => domainPriority(a, 'debug') - domainPriority(b, 'debug'));
    return withApplied({ ...candidates, personas }, 'B-debug-bias');
  }
  if (DEPLOY_VERBS.test(task)) {
    personas.sort((a, b) => domainPriority(a, 'devops') - domainPriority(b, 'devops'));
    return withApplied({ ...candidates, personas }, 'B-devops-bias');
  }
  return candidates;
}

function domainPriority(persona, target) {
  if (persona.domain === target) return 0;
  if ((persona.secondaryDomains ?? []).includes(target)) return 1;
  return 2;
}

// ─── Export the chain in evaluation order ───────────────────────────────────

export const RULES = [
  { id: 'R1',  kind: 'hard', apply: R1_active_session_attach },
  { id: 'R2',  kind: 'hard', apply: R2_secret_keywords_force_local },
  { id: 'R3',  kind: 'hard', apply: R3_privacy_mode_force_local },
  { id: 'R4',  kind: 'hard', apply: R4_daily_cap_force_local },
  { id: 'R5',  kind: 'soft', apply: R5_drop_quota_exhausted },
  { id: 'R6',  kind: 'soft', apply: R6_demote_quota_yellow },
  { id: 'R7',  kind: 'hard', apply: R7_block_local_unavailable },
  { id: 'R8',  kind: 'soft', apply: R8_restrict_devops_verbs },
  { id: 'R9',  kind: 'soft', apply: R9_debug_verb_bias },
  { id: 'R10', kind: 'soft', apply: R10_oneshot_tag },
  { id: 'R11', kind: 'soft', apply: R11_long_running_tag },
  { id: 'R12', kind: 'soft', apply: R12_cross_project_cache },
  { id: 'R13', kind: 'hard', apply: R13_exclude_router_personas },
  { id: 'R14', kind: 'soft', apply: R14_drop_review_no_diff },
  { id: 'R15', kind: 'soft', apply: R15_drop_low_score_history },
  { id: 'R16', kind: 'soft', apply: R16_trim_history },
  { id: 'B',   kind: 'soft', apply: bias_persona_by_verbs },
];
