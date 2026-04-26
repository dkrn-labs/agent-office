/**
 * Pure prompt assembly for the frontdesk LLM stage. Returns the
 * `{ system, messages }` shape consumed by the Anthropic SDK's
 * `messages.create` call. **Has no side effects** — no SDK import, no
 * env reads — so it's safe to unit-test without an API key and safe to
 * reason about in isolation when the persona/skill schema changes.
 *
 * Layout follows architecture §6.2:
 *
 *   system: [
 *     { type: 'text', text: <role + output schema> },                 // static
 *     { type: 'text', text: <persona catalog>,    cache_control: 'ephemeral' },
 *     { type: 'text', text: <skill catalog>,      cache_control: 'ephemeral' },
 *     { type: 'text', text: <rule chain summary>, cache_control: 'ephemeral' },
 *   ]
 *   messages: [
 *     { role: 'user', content: <task + rule trace + candidates> },    // dynamic
 *   ]
 *
 * Cached prefix lands ~6k tokens; dynamic suffix ~1k. Task text must
 * stay in the user turn — embedding it in `system` would defeat caching.
 */

import { buildFewShotBlock } from './few-shot.js';

const SYSTEM_TEXT = [
  'You are the frontdesk for an agent office. You receive a task description, a set of candidate personas and providers (already filtered by deterministic rules), and the rule trace that produced them. Your job is to pick the best persona, provider, model, and supporting context for this specific task.',
  '',
  'You MUST return a single JSON object matching this schema:',
  '{',
  '  "persona": "<persona label from the candidate list>",',
  '  "provider": "<provider id from the candidate list>",',
  '  "model": "<model id, e.g. claude-opus-4-7>",',
  '  "taskType": "oneshot" | "iterative" | "long-running",',
  '  "estimatedDuration": "<5min" | "5-30min" | ">30min",',
  '  "complexity": <integer 1..10>,',
  '  "history_picks": [<history session id>, ...],',
  '  "skills_picks": ["<skill id>", ...],',
  '  "reasoning": "<one or two sentences justifying the pick, surfaced in UI>",',
  '  "fallback_if_blocked": { "provider": "<id>", "reason": "<short>" } | null',
  '}',
  '',
  'Pick only from the provided candidates. Never invent personas or providers. Keep `reasoning` short — operators read it at a glance.',
  '',
  '## Vendor selection criteria',
  '',
  'When multiple providers are candidates, choose by matching the task to vendor strengths — do NOT default to the first one in the list.',
  '',
  '- **Local providers (kind=local, costTier=free)** are the right choice for trivial mechanical tasks (rename, format, single-file comment edits, commits) and any task where `mustBeLocal=true`. They cost $0 and never burn cloud quota.',
  '- **Cloud providers (kind=cloud)** carry token cost (`costTier`: $ < $$ < $$$). Pick the cheapest tier whose `strengths` match the task domain. Use the most expensive tier only when the task explicitly demands it (cross-codebase refactors, sustained reasoning, multi-step planning).',
  '- When two providers have similar `strengths`, prefer the one with the lower `costTier`.',
  '- When a provider in the candidate set is `installed=false`, treat it as last-resort — pick another candidate if any installed alternative is reasonable.',
  '- **If your chosen provider has a configured `fallback`, populate `fallback_if_blocked` with that fallback id and a short reason** (e.g. "rate limit on primary"). The launcher uses this to recover when the primary\'s quota is exhausted at spawn time. Set to `null` only when no fallback is configured.',
].join('\n');

/**
 * @param {Array} personas — repo.listPersonas() shape
 * @returns {string}
 */
export function buildPersonaCatalogBlock(personas = []) {
  const lines = ['# Persona catalog', ''];
  for (const p of personas) {
    const secondary = Array.isArray(p.secondaryDomains) && p.secondaryDomains.length
      ? ` (also: ${p.secondaryDomains.join(', ')})`
      : '';
    lines.push(`- ${p.label} — domain: ${p.domain}${secondary}`);
    if (p.systemPromptTemplate) {
      const oneLine = String(p.systemPromptTemplate).replace(/\s+/g, ' ').slice(0, 240);
      lines.push(`  prompt: ${oneLine}`);
    }
  }
  return lines.join('\n');
}

/**
 * @param {Array} skills — repo.listSkills() shape
 * @returns {string}
 */
export function buildSkillCatalogBlock(skills = []) {
  const lines = ['# Skill catalog', ''];
  if (!skills.length) {
    lines.push('(no skills registered)');
    return lines.join('\n');
  }
  for (const s of skills) {
    const desc = s.description ? ` — ${s.description}` : '';
    lines.push(`- ${s.id}: ${s.label ?? s.id}${desc}`);
  }
  return lines.join('\n');
}

const RULE_DESCRIPTIONS = {
  R1: 'attach to active session if persona+project match',
  R2: 'force local on secret/PII keywords',
  R3: 'force local when privacyMode=strict',
  R4: 'force local when daily $ cap is hit',
  R5: 'drop providers over 95% quota',
  R6: 'demote providers in 80–95% quota band',
  R7: 'block when mustBeLocal but no local model loaded',
  R8: 'restrict to devops persona on deploy/release verbs',
  R9: 'bias debug persona on debug/fix/crash verbs',
  R10: 'tag oneshot for short mechanical tasks',
  R11: 'tag long-running for big-scope tasks',
  R12: 'penalty when switching projects from cache-warm one',
  R13: 'never auto-pick frontdesk/lead personas',
  R14: 'drop reviewer when no recent diff/PR',
  R15: 'drop history candidates with score < 0.4',
  R16: 'trim history when prefill > 12k tokens',
  B:   'verb-bias persona ordering',
};

/**
 * @param {string[]} ruleIds
 * @returns {string}
 */
export function buildRuleChainSummary(ruleIds = []) {
  const lines = ['# Deterministic rules already applied', ''];
  if (!ruleIds.length) {
    lines.push('(no rules fired)');
    return lines.join('\n');
  }
  for (const id of ruleIds) {
    const desc = RULE_DESCRIPTIONS[id] ?? '(custom rule)';
    lines.push(`- ${id}: ${desc}`);
  }
  lines.push('');
  lines.push('Hard-rule outputs are authoritative. Do not contradict mustBeLocal or attach decisions.');
  return lines.join('\n');
}

/**
 * @param {{ task: string, candidates: object }} arg
 * @returns {string}
 */
export function buildDynamicSuffix({ task, candidates }) {
  const lines = ['# Task', ''];
  lines.push(String(task).trim());
  lines.push('');
  lines.push('# Rule trace');
  const ids = Array.isArray(candidates?.rulesApplied) ? candidates.rulesApplied : [];
  lines.push(ids.length ? ids.join(', ') : '(none)');
  lines.push('');
  lines.push('# Candidates');
  lines.push('Personas: ' + (candidates?.personas ?? []).map((p) => p.label ?? p.id).join(', '));
  lines.push('Providers: ' + (candidates?.providers ?? []).map((p) => p.id).join(', '));
  if (candidates?.constraints) {
    const c = candidates.constraints;
    if (c.mustBeLocal) lines.push(`Constraint: mustBeLocal (${c.mustBeLocalReason ?? 'unspecified'})`);
    if (c.attachTo) lines.push(`Constraint: attach to session ${c.attachTo.id ?? c.attachTo.sessionId}`);
    if (c.blockedReason) lines.push(`Blocked: ${c.blockedReason}`);
  }
  lines.push('');
  lines.push('Return only the JSON object.');
  return lines.join('\n');
}

/**
 * Build the provider catalog block. When `state.providerCapabilities`
 * (the registry from Task 11) is supplied, render strengths + costTier +
 * weaknesses + installed status per candidate. Otherwise emit a minimal
 * id+kind list (back-compat for tests/callers that don't have a registry
 * wired up).
 *
 * @param {Array<{id: string, kind?: string}>} candidateProviders
 * @param {object|null} providerCapabilities
 * @returns {string}
 */
export function buildProviderCatalogBlock(candidateProviders = [], providerCapabilities = null) {
  const lines = ['# Provider catalog', ''];
  if (!candidateProviders.length) {
    lines.push('(no providers in candidate set)');
    return lines.join('\n');
  }
  for (const cand of candidateProviders) {
    const meta = providerCapabilities?.providers?.[cand.id];
    const defaultModel = meta?.models?.find((m) => m.default) ?? meta?.models?.[0] ?? null;
    const label = meta?.label ?? cand.id;
    const kind = cand.kind ?? meta?.kind ?? 'unknown';
    const cost = defaultModel?.costTier ?? '?';
    const installed = meta?.installed === true ? 'installed'
                     : meta?.installed === false ? 'not installed'
                     : 'unknown';
    lines.push(`- ${cand.id} — ${label} (${kind}, costTier=${cost}, ${installed})`);
    if (defaultModel?.id) lines.push(`  default model: ${defaultModel.id}`);
    if (meta?.fallback) lines.push(`  fallback when blocked: ${meta.fallback}`);
    if (Array.isArray(defaultModel?.strengths) && defaultModel.strengths.length) {
      lines.push(`  strengths: ${defaultModel.strengths.join('; ')}`);
    }
    if (Array.isArray(defaultModel?.weaknesses) && defaultModel.weaknesses.length) {
      lines.push(`  weaknesses: ${defaultModel.weaknesses.join('; ')}`);
    }
    // Surface benchmark numbers as a bulleted list. The router model
    // anchors on numbers when present; cross-vendor comparison only works
    // when each vendor has the same benchmark surfaced.
    const benchParts = [];
    if (typeof defaultModel?.swebenchVerified === 'number') {
      benchParts.push(`SWE-bench Verified ${(defaultModel.swebenchVerified * 100).toFixed(1)}%`);
    }
    if (typeof defaultModel?.swebenchPro === 'number') {
      benchParts.push(`SWE-bench Pro ${(defaultModel.swebenchPro * 100).toFixed(1)}%`);
    }
    if (typeof defaultModel?.terminalBench2 === 'number') {
      benchParts.push(`Terminal-Bench 2.0 ${(defaultModel.terminalBench2 * 100).toFixed(1)}%`);
    }
    if (benchParts.length) lines.push(`  benchmarks: ${benchParts.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * @param {{ state: object, task: string, candidates: object }} arg
 * @returns {{ system: Array<object>, messages: Array<object> }}
 */
export function buildPrompt({ state, task, candidates }) {
  const personaBlock = buildPersonaCatalogBlock(state?.personas ?? []);
  const skillBlock = buildSkillCatalogBlock(state?.skills ?? []);
  const providerBlock = buildProviderCatalogBlock(
    candidates?.providers ?? [],
    state?.providerCapabilities ?? null,
  );
  const ruleSummary = buildRuleChainSummary(candidates?.rulesApplied ?? []);

  // P5-D — few-shot block from accepted decisions in the last N days.
  // Only inserted when the runner provides decisions AND the count
  // clears the cold-start floor (typically 3). Stays in the cached
  // ephemeral region next to its catalog siblings so LMStudio /
  // Anthropic keep prefix-cache hits across calls in the same day.
  const fewShotText = buildFewShotBlock(state?.recentAcceptedDecisions ?? []);

  const system = [
    { type: 'text', text: SYSTEM_TEXT },
    { type: 'text', text: personaBlock,  cache_control: { type: 'ephemeral' } },
    { type: 'text', text: skillBlock,    cache_control: { type: 'ephemeral' } },
    { type: 'text', text: providerBlock, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: ruleSummary,   cache_control: { type: 'ephemeral' } },
  ];
  if (fewShotText) {
    // Insert just before rule summary so the LLM sees catalogs first,
    // then "what worked recently", then the rule trace.
    system.splice(system.length - 1, 0, {
      type: 'text', text: fewShotText, cache_control: { type: 'ephemeral' },
    });
  }

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: buildDynamicSuffix({ task, candidates }) },
      ],
    },
  ];

  return { system, messages };
}
