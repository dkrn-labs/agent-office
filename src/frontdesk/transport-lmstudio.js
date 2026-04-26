import { buildPrompt } from './prompt.js';
import { validateAndFallback, buildFallbackProposal } from './llm.js';

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

  const body = {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'frontdesk_proposal', strict: true, schema: JSON_SCHEMA },
    },
    messages,
  };

  let response;
  try {
    response = await fetch(`${host}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      proposal: buildFallbackProposal({ candidates, fallback: 'error', errorMessage: err?.message }),
      meta: { usedLLM: true, transport: 'lmstudio', fallback: 'error', errorMessage: err?.message ?? String(err) },
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      proposal: buildFallbackProposal({ candidates, fallback: 'error', errorMessage: `HTTP ${response.status}` }),
      meta: {
        usedLLM: true,
        transport: 'lmstudio',
        fallback: 'error',
        errorMessage: `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      },
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    return {
      proposal: buildFallbackProposal({ candidates, fallback: 'error', errorMessage: 'invalid JSON in response body' }),
      meta: { usedLLM: true, transport: 'lmstudio', fallback: 'error', errorMessage: err?.message ?? String(err) },
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
