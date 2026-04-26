import { z } from 'zod';

import { runSdk } from './transport-sdk.js';
import { runLmstudio } from './transport-lmstudio.js';

/**
 * Output schema (architecture §6.2). The LLM MUST return this shape;
 * anything else triggers the rules-only fallback so a launch is never
 * blocked on a router hiccup.
 *
 * Shared across transports — both `transport-sdk.js` and
 * `transport-lmstudio.js` import this and `validateAndFallback` to
 * funnel raw model output through the same Zod gate.
 */
export const ProposalSchema = z.object({
  persona: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  taskType: z.enum(['oneshot', 'iterative', 'long-running']),
  estimatedDuration: z.enum(['<5min', '5-30min', '>30min']),
  complexity: z.number().int().min(1).max(10),
  history_picks: z.array(z.union([z.number(), z.string()])).default([]),
  skills_picks: z.array(z.string()).default([]),
  reasoning: z.string().min(1),
  fallback_if_blocked: z
    .object({ provider: z.string(), reason: z.string() })
    .nullable()
    .optional(),
});

/**
 * Conservative JSON extractor — finds the first `{...}` block in the text.
 * The schema prompt asks for "only the JSON object" so this is normally a
 * straight `JSON.parse(text)`, but the model occasionally wraps the JSON in
 * prose. A failure here drops to the schema fallback.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function extractJSON(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new Error('empty LLM response');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('no JSON object found in LLM response');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

/**
 * Construct the rules-only fallback proposal — first candidate of each
 * type, with a reasoning string that names *why* we fell back so the
 * operator (and the decision log) can spot router hiccups.
 */
export function buildFallbackProposal({ candidates, fallback, errorMessage }) {
  const persona = candidates?.personas?.[0]?.label ?? candidates?.personas?.[0]?.id ?? 'unknown';
  const provider = candidates?.providers?.[0]?.id ?? 'unknown';
  const reason = fallback === 'schema'
    ? 'LLM output failed schema validation; using rules-only fallback (first candidate of each type).'
    : `LLM call failed (${errorMessage ?? 'unknown error'}); using rules-only fallback.`;
  return {
    persona,
    provider,
    model: candidates?.providers?.[0]?.model ?? '',
    taskType: 'iterative',
    estimatedDuration: '5-30min',
    complexity: 5,
    history_picks: [],
    skills_picks: [],
    reasoning: reason,
    fallback_if_blocked: null,
  };
}

/**
 * Funnel raw model output through parse + Zod + candidate-membership
 * checks. Either returns `{ ok: true, proposal }` or
 * `{ ok: false, proposal: <fallback>, meta }`. Both transports share
 * this so JSON-mode handling is identical regardless of backend.
 *
 * @param {string} rawText
 * @param {object} candidates
 * @returns {{ ok: boolean, proposal: object, meta?: object }}
 */
export function validateAndFallback(rawText, candidates) {
  let parsed;
  try {
    const json = extractJSON(rawText);
    const validated = ProposalSchema.safeParse(json);
    if (!validated.success) {
      return {
        ok: false,
        proposal: buildFallbackProposal({ candidates, fallback: 'schema' }),
        meta: { fallback: 'schema', validationError: validated.error.issues },
      };
    }
    parsed = validated.data;
  } catch (err) {
    return {
      ok: false,
      proposal: buildFallbackProposal({ candidates, fallback: 'schema' }),
      meta: { fallback: 'schema', parseError: err?.message ?? String(err) },
    };
  }

  // Defensive: the model must pick from the candidate list. If it invents
  // a persona or provider, treat as schema failure.
  const personaLabels = new Set((candidates?.personas ?? []).map((p) => p.label ?? p.id));
  const providerIds = new Set((candidates?.providers ?? []).map((p) => p.id));
  if (personaLabels.size && !personaLabels.has(parsed.persona)) {
    return {
      ok: false,
      proposal: buildFallbackProposal({ candidates, fallback: 'schema' }),
      meta: { fallback: 'schema', reason: 'persona not in candidates' },
    };
  }
  if (providerIds.size && !providerIds.has(parsed.provider)) {
    return {
      ok: false,
      proposal: buildFallbackProposal({ candidates, fallback: 'schema' }),
      meta: { fallback: 'schema', reason: 'provider not in candidates' },
    };
  }

  return { ok: true, proposal: parsed };
}

/**
 * Run the LLM stage. **Never throws.** Returns
 * `{ proposal, meta: { usedLLM, transport, fallback, errorMessage?, usage? } }`.
 *
 * `meta.fallback` values:
 *   - `null`     happy path; proposal came from the LLM
 *   - `'schema'` LLM responded but the output failed parse/validation
 *   - `'error'`  network / SDK / quota error from the call itself
 *
 * Dispatches based on `transport`:
 *   - `'sdk'`      → `transport-sdk.js` (Anthropic SDK + prompt caching)
 *   - `'lmstudio'` → `transport-lmstudio.js` (local OpenAI-compat HTTP)
 *
 * @param {{
 *   transport?: 'sdk'|'lmstudio',
 *   client?: object,           // required when transport==='sdk'
 *   host?: string,             // required when transport==='lmstudio'
 *   model: string,
 *   state: object,
 *   task: string,
 *   candidates: object,
 *   maxTokens?: number,
 * }} arg
 * @returns {Promise<{ proposal: object, meta: object }>}
 */
export async function runLLM(arg) {
  const transport = arg.transport ?? (arg.client ? 'sdk' : 'lmstudio');
  if (transport === 'sdk') return runSdk(arg);
  if (transport === 'lmstudio') return runLmstudio(arg);
  throw new Error(`runLLM: unknown transport '${transport}'`);
}

/**
 * Pre-bind a `runLLM` for a given transport configuration. Used by
 * `src/api/server.js` to construct the dep injected into the frontdesk
 * route — runner-level callers only need to supply `{ state, task,
 * candidates }` afterwards.
 *
 * @param {{
 *   enabled: boolean,
 *   transport: 'sdk'|'lmstudio',
 *   model: string,
 *   maxTokens?: number,
 *   sdk?: { client: object },
 *   lmstudio?: { host: string, model: string },
 * }} settings
 * @returns {(arg: { state: object, task: string, candidates: object }) => Promise<object>}
 */
export function createRunLLM(settings) {
  if (!settings?.enabled) {
    // Sentinel: server.js callers can use this safely. Runner already
    // gates on enabled, so this should never fire — return a marker so a
    // misuse is loud rather than silent.
    return async () => {
      throw new Error('createRunLLM: frontdesk.llm.enabled is false');
    };
  }
  const transport = settings.transport ?? 'lmstudio';
  if (transport === 'sdk') {
    if (!settings.sdk?.client) {
      throw new Error('createRunLLM: transport=sdk requires settings.sdk.client');
    }
    return ({ state, task, candidates }) => runLLM({
      transport: 'sdk',
      client: settings.sdk.client,
      model: settings.model,
      maxTokens: settings.maxTokens ?? 1024,
      state, task, candidates,
    });
  }
  return ({ state, task, candidates }) => runLLM({
    transport: 'lmstudio',
    host: settings.lmstudio?.host ?? 'http://localhost:1234',
    model: settings.lmstudio?.model ?? 'google/gemma-4-e4b',
    maxTokens: settings.maxTokens ?? 1024,
    state, task, candidates,
  });
}
