/**
 * Context budget — computes how many tokens a launch *would* load with
 * no filtering ("baseline") vs what it actually loads after persona
 * filter + skill resolution + history selection ("optimized").
 *
 * Persisted per-launch in `launch_budget`. Drives the savings pill on
 * the v2 UI. Outcome-weighted at roll-up time so a rejected-but-cheap
 * launch doesn't count as savings.
 *
 * Approximation: token count = ceil(chars / 4). Good enough for
 * ratio-based UX. Swap to a real tokenizer (tiktoken-like) only if
 * accuracy ever materially affects a product decision.
 */

const CHARS_PER_TOKEN = 4;

/** @param {string|null|undefined} text */
export function approxTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Sum tokens across an array of {body|content|text} or string items.
 * @param {Array<string|{body?:string,content?:string,text?:string,narrative?:string}>} items
 */
function sumItems(items = []) {
  let sum = 0;
  for (const it of items) {
    if (typeof it === 'string') sum += approxTokens(it);
    else if (it) sum += approxTokens(it.body ?? it.content ?? it.text ?? it.narrative ?? '');
  }
  return sum;
}

/**
 * Compute the optimized-side breakdown — what *will* be loaded for this
 * specific launch.
 *
 * @param {{
 *   systemPrompt: string,
 *   skills?: Array<{label?:string, content?:string, body?:string}>,
 *   personaObservations?: Array<{narrative?:string, title?:string}>,
 *   memories?: Array<{body?:string, content?:string}>,
 * }} input
 * @returns {{ persona: number, skills: number, history: number, memory: number, total: number }}
 */
export function computeOptimized(input) {
  const persona = approxTokens(input.systemPrompt);
  const skills = sumItems(input.skills ?? []);
  const history = sumItems(input.personaObservations ?? []);
  const memory = sumItems(input.memories ?? []);
  return { persona, skills, history, memory, total: persona + skills + history + memory };
}

/**
 * Compute the baseline-side breakdown — what a *naive* launch would have
 * loaded with no filtering: full system prompt + every installed skill +
 * all recent observations (unfiltered) + full memory dump.
 *
 * Caller passes the unfiltered candidate sets so this module stays pure.
 *
 * @param {{
 *   systemPrompt: string,
 *   allSkills?: Array<{label?:string, content?:string, body?:string}>,
 *   allObservations?: Array<{narrative?:string, title?:string}>,
 *   allMemories?: Array<{body?:string, content?:string}>,
 * }} input
 * @returns {{ persona: number, skills: number, history: number, memory: number, total: number }}
 */
export function computeBaseline(input) {
  const persona = approxTokens(input.systemPrompt);
  const skills = sumItems(input.allSkills ?? []);
  const history = sumItems(input.allObservations ?? []);
  const memory = sumItems(input.allMemories ?? []);
  return { persona, skills, history, memory, total: persona + skills + history + memory };
}

/**
 * Convenience: compute both sides at once and return the launch_budget
 * row shape ready to persist.
 *
 * @param {{
 *   providerId: string,
 *   model: string|null,
 *   optimized: Parameters<typeof computeOptimized>[0],
 *   baseline: Parameters<typeof computeBaseline>[0],
 *   cost?: { dollars?: number, cloudEquivalent?: number },
 * }} input
 */
export function buildLaunchBudgetRow(input) {
  const optimized = computeOptimized(input.optimized);
  const baseline = computeBaseline(input.baseline);
  return {
    providerId: input.providerId,
    model: input.model ?? null,
    baselineTokens: baseline.total,
    optimizedTokens: optimized.total,
    baselineBreakdown: baseline,
    optimizedBreakdown: optimized,
    costDollars: input.cost?.dollars ?? null,
    cloudEquivalentDollars: input.cost?.cloudEquivalent ?? null,
  };
}

/**
 * Compute the savings rollup over a window. `rows` are launch_budget
 * rows already filtered to the window. Outcome-weighted:
 * `rejected` is excluded.
 *
 * @param {Array<{baselineTokens:number, optimizedTokens:number, costDollars:number|null, outcome:string|null}>} rows
 */
export function rollupSavings(rows) {
  let baseline = 0;
  let optimized = 0;
  let dollars = 0;
  let credited = 0;
  for (const r of rows) {
    if (r.outcome === 'rejected') continue;
    baseline += r.baselineTokens ?? 0;
    optimized += r.optimizedTokens ?? 0;
    if (typeof r.costDollars === 'number') dollars += r.costDollars;
    credited += 1;
  }
  const saved = Math.max(0, baseline - optimized);
  const pct = baseline > 0 ? Math.round((saved / baseline) * 100) : 0;
  return {
    sessions: credited,
    baselineTokens: baseline,
    optimizedTokens: optimized,
    savedTokens: saved,
    savedPct: pct,
    costDollars: dollars,
  };
}
