import { buildPrompt } from './prompt.js';
import { validateAndFallback, buildFallbackProposal } from './llm.js';

/**
 * Pull the first text block out of an Anthropic SDK response.
 * The SDK returns `{ content: [{ type: 'text', text: '...' }, ...], ... }`.
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
 * Anthropic SDK transport. Uses `cache_control: { type: 'ephemeral' }`
 * blocks emitted by `prompt.js` to amortize the prefix across calls.
 * Never throws — every error path returns the rules-only fallback.
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
export async function runSdk({ client, model, state, task, candidates, maxTokens = 1024 }) {
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
      meta: { usedLLM: true, transport: 'sdk', fallback: 'error', errorMessage: err?.message ?? String(err) },
    };
  }

  const text = extractText(response);
  const result = validateAndFallback(text, candidates);
  if (!result.ok) {
    return {
      proposal: result.proposal,
      meta: { usedLLM: true, transport: 'sdk', ...(result.meta ?? {}) },
    };
  }

  return {
    proposal: result.proposal,
    meta: {
      usedLLM: true,
      transport: 'sdk',
      fallback: null,
      usage: response.usage ?? null,
    },
  };
}
