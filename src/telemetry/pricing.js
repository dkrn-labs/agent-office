/**
 * Per-model pricing in USD per million tokens. Keep in sync with
 * https://www.anthropic.com/pricing
 *
 * Last verified: 2026-04-14
 */
export const MODEL_PRICING = {
  'claude-opus-4-6': {
    inputPerMtok:      15.0,
    outputPerMtok:     75.0,
    cacheReadPerMtok:   1.5,
    cacheWritePerMtok: 18.75,
  },
  'claude-sonnet-4-6': {
    inputPerMtok:       3.0,
    outputPerMtok:     15.0,
    cacheReadPerMtok:   0.30,
    cacheWritePerMtok:  3.75,
  },
  'claude-haiku-4-5': {
    inputPerMtok:       1.0,
    outputPerMtok:      5.0,
    cacheReadPerMtok:   0.10,
    cacheWritePerMtok:  1.25,
  },
};

/**
 * Compute cost in USD for a single usage block.
 *
 * @param {{
 *   model: string,
 *   tokensIn?: number,
 *   tokensOut?: number,
 *   cacheRead?: number,
 *   cacheWrite?: number,
 * }} usage
 * @returns {number|null}  USD, or null if model is unknown
 */
export function computeCostUsd({ model, tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheWrite = 0 }) {
  const p = MODEL_PRICING[model];
  if (!p) return null;
  return (
    (tokensIn    / 1_000_000) * p.inputPerMtok +
    (tokensOut   / 1_000_000) * p.outputPerMtok +
    (cacheRead   / 1_000_000) * p.cacheReadPerMtok +
    (cacheWrite  / 1_000_000) * p.cacheWritePerMtok
  );
}
