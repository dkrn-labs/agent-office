export function formatTokens(value) {
  if (value == null) return '0';
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function formatUsd(value) {
  if (value == null) return '—';
  return `$${Number(value).toFixed(2)}`;
}

export default function CostFormatter({ costUsd, tokens }) {
  return (
    <span className="cost-formatter">
      {formatUsd(costUsd)} · {formatTokens(tokens)} tokens
    </span>
  );
}
