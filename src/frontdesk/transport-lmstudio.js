import { buildPrompt } from './prompt.js';
import { validateAndFallback, buildFallbackProposal } from './llm.js';
import { createLmStudioBridge, LmStudioError } from '../providers/lmstudio-bridge.js';

/**
 * Strict JSON Schema constraint passed to LMStudio's
 * `response_format.json_schema`. Mirrors the Zod ProposalSchema; LMStudio's
 * MLX backend rejects union-typed array items
 * (`type: ['number','string']`), so `history_picks` is narrowed to strings
 * here. The Zod gate downstream still accepts numbers so an SDK transport
 * with a more lenient model isn't penalized.
 */
const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['persona', 'provider', 'model', 'taskType', 'estimatedDuration', 'complexity', 'history_picks', 'skills_picks', 'reasoning'],
  properties: {
    persona: { type: 'string' },
    provider: { type: 'string' },
    model: { type: 'string' },
    taskType: { type: 'string', enum: ['oneshot', 'iterative', 'long-running'] },
    estimatedDuration: { type: 'string', enum: ['<5min', '5-30min', '>30min'] },
    complexity: { type: 'integer', minimum: 1, maximum: 10 },
    history_picks: { type: 'array', items: { type: 'string' } },
    skills_picks: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
    fallback_if_blocked: {
      anyOf: [
        { type: 'null' },
        { type: 'object', required: ['provider', 'reason'], properties: { provider: { type: 'string' }, reason: { type: 'string' } } },
      ],
    },
  },
};

/**
 * Render the Anthropic-style block list emitted by `prompt.js` into an
 * OpenAI-compatible `messages` array. The block boundaries (system /
 * persona catalog / skill catalog / rule summary) collapse into a single
 * concatenated `system` content string. Dynamic suffix stays in the user
 * turn so cache discipline is preserved at the local-runtime level
 * (LMStudio + Ollama both warm-cache identical prefixes via `keep_alive`).
 *
 * @param {{ system: Array<{text: string}>, messages: Array<object> }} built
 * @returns {{ role: string, content: string }[]}
 */
function renderForOpenAI(built) {
  const sys = built.system.map((b) => b.text).join('\n\n---\n\n');
  return [
    { role: 'system', content: sys },
    ...built.messages.map((m) => ({
      role: m.role,
      content: Array.isArray(m.content) ? m.content.map((c) => c.text).join('\n') : m.content,
    })),
  ];
}

/**
 * LMStudio (or any OpenAI-compatible local server) transport. Hits
 * `${host}/v1/chat/completions` with strict json_schema constrained
 * decoding, temperature 0, and a `keep_alive`-friendly request that
 * lets the server hold the KV cache warm across calls.
 *
 * Never throws — every error path returns the rules-only fallback.
 *
 * @param {{
 *   host: string,
 *   model: string,
 *   state: object,
 *   task: string,
 *   candidates: object,
 *   maxTokens?: number,
 * }} arg
 * @returns {Promise<{ proposal: object, meta: object }>}
 */
export async function runLmstudio({ host, model, state, task, candidates, maxTokens = 1024 }) {
  const built = buildPrompt({ state, task, candidates });
  const messages = renderForOpenAI(built);

  // Frontdesk shouldn't use the cached health probe — every routing
  // call wants a fresh completion. We construct the bridge per-call;
  // it's a thin object with no I/O of its own at construction time.
  const bridge = createLmStudioBridge({ host });

  let payload;
  try {
    payload = await bridge.complete({
      model,
      messages,
      maxTokens,
      temperature: 0,
      responseFormat: {
        type: 'json_schema',
        json_schema: { name: 'frontdesk_proposal', strict: true, schema: JSON_SCHEMA },
      },
    });
  } catch (err) {
    const msg = err instanceof LmStudioError ? err.message : err?.message ?? String(err);
    return {
      proposal: buildFallbackProposal({ candidates, fallback: 'error', errorMessage: msg }),
      meta: { usedLLM: true, transport: 'lmstudio', fallback: 'error', errorMessage: msg },
    };
  }

  const text = payload?.choices?.[0]?.message?.content ?? '';
  const result = validateAndFallback(text, candidates);
  if (!result.ok) {
    return {
      proposal: result.proposal,
      meta: { usedLLM: true, transport: 'lmstudio', ...(result.meta ?? {}) },
    };
  }

  return {
    proposal: result.proposal,
    meta: {
      usedLLM: true,
      transport: 'lmstudio',
      fallback: null,
      usage: payload.usage ?? null,
    },
  };
}
