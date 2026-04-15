export default function OutcomeBadge({ outcome = 'unknown' }) {
  return (
    <span className={`outcome-badge outcome-badge--${outcome}`}>
      {outcome}
    </span>
  );
}
