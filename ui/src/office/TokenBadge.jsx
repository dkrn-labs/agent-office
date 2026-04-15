/**
 * TokenBadge — token usage pill shown above a character.
 *
 * Props:
 *   totals  — { input_tokens, output_tokens, cost_usd } or null/undefined
 *   working — boolean; true while actively receiving updates
 */

/**
 * formatTokens(n) — compact display for token counts.
 *   0        → '0'
 *   999      → '999'
 *   1 000    → '1.0k'
 *   1 500    → '1.5k'
 *   45 200   → '45.2k'
 *   1 200 000→ '1.2M'
 */
export function formatTokens(n) {
  if (n === 0 || n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${parseFloat(k.toFixed(1))}k`;
  }
  const m = n / 1_000_000;
  return `${parseFloat(m.toFixed(1))}M`;
}

export default function TokenBadge({ totals, working }) {
  if (!totals) return null;

  const total =
    totals.total ??
    (totals.tokensIn ?? totals.input_tokens ?? 0) +
      (totals.tokensOut ?? totals.output_tokens ?? 0) +
      (totals.cacheRead ?? 0) +
      (totals.cacheWrite ?? 0);
  if (total === 0) return null;

  const label = formatTokens(total);

  return (
    <span
      className={[
        'token-badge',
        working ? 'token-badge--working' : 'token-badge--idle',
        working ? 'token-badge--pulse' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {label}
    </span>
  );
}
