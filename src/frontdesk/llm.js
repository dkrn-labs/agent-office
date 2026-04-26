import { z } from 'zod';

import { buildPrompt } from './prompt.js';

/**
 * Output schema (architecture §6.2). The LLM MUST return this shape;
 * anything else triggers the rules-only fallback so a launch is never
 * blocked on a router hiccup.
 */
const ProposalSchema = z.object({
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
 * Pull the first text block out of the SDK response. The Anthropic SDK
 * returns `{ content: [{ type: 'text', text: '...' }, ...], ... }`.
 *
 * @param {object} response
 * @returns {string}
 */
function extractText(response) {
  const content = response?.content;
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
}

/**
 * Conservative JSON extractor — finds the first `{...}` block in the text.
 * The schema prompt asks for "only the JSON object" so this is normally a
 * straight `JSON.parse(text)`, but the model occasionally wraps the JSON in
 * prose. A failure here drops to the schema fallback.
 *
 * @param {string} text
 * @returns {unknown}
 */
function extractJSON(text) {
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
 *
 * @param {{ candidates: object, fallback: 'schema'|'error', errorMessage?: string }} arg
 * @returns {object}
 */
function buildFallbackProposal({ candidates, fallback, errorMessage }) {
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
 * Run the LLM stage. **Never throws.** Returns
 * `{ proposal, meta: { usedLLM, fallback, errorMessage?, usage? } }`.
 *
 * `meta.fallback` values:
 *   - `null`     happy path; proposal came from the LLM
 *   - `'schema'` LLM responded but the output failed parse/validation
 *   - `'error'`  SDK / network / quota error from the LLM call itself
 *
 * @param {{
 *   client: { messages: { create: Function } },
 *   model: string,
 *   state: object,
 *   task: string,
 *   candidates: object,
 *   maxTokens?: number,
 * }} arg
 * @returns {Promise<{ proposal: object, meta: object }>}
 */
export async function runLLM({ client, model, state, task, candidates, maxTokens = 600 }) {
  const { system, messages } = buildPrompt({ state, task, candidates });

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
    });
  } catch (err) {
    return {
      proposal: buildFallbackProposal({ candidates, fallback: 'error', errorMessage: err?.message }),
      meta: { usedLLM: true, fallback: 'error', errorMessage: err?.message ?? String(err) },
    };
  }

  let parsed;
  try {
    const text = extractText(response);
    const json = extractJSON(text);
    const validated = ProposalSchema.safeParse(json);
    if (!validated.success) {
      return {
        proposal: buildFallbackProposal({ candidates, fallback: 'schema' }),
        meta: { usedLLM: true, fallback: 'schema', validationError: validated.error.issues },
      };
    }
    parsed = validated.data;
  } catch (err) {
    return {
      proposal: buildFallbackProposal({ candidates, fallback: 'schema' }),
      meta: { usedLLM: true, fallback: 'schema', parseError: err?.message ?? String(err) },
    };
  }

  // Defensive: the model must pick from the candidate list. If it invents
  // a persona or provider, treat as schema failure.
  const personaLabels = new Set((candidates?.personas ?? []).map((p) => p.label ?? p.id));
  const providerIds = new Set((candidates?.providers ?? []).map((p) => p.id));
  if (personaLabels.size && !personaLabels.has(parsed.persona)) {
    return {
      proposal: buildFallbackProposal({ candidates, fallback: 'schema' }),
      meta: { usedLLM: true, fallback: 'schema', reason: 'persona not in candidates' },
    };
  }
  if (providerIds.size && !providerIds.has(parsed.provider)) {
    return {
      proposal: buildFallbackProposal({ candidates, fallback: 'schema' }),
      meta: { usedLLM: true, fallback: 'schema', reason: 'provider not in candidates' },
    };
  }

  return {
    proposal: parsed,
    meta: {
      usedLLM: true,
      fallback: null,
      usage: response.usage ?? null,
    },
  };
}
