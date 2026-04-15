export default function PulseChart({ buckets = [] }) {
  const values = buckets.map((bucket) => bucket.tokens ?? 0);
  const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const max = Math.max(...values, 1);

  function tier(value) {
    if (avg <= 0) return 'pulse-bar--low';
    if (value > avg * 1.5) return 'pulse-bar--high';
    if (value > avg * 0.5) return 'pulse-bar--mid';
    return 'pulse-bar--low';
  }

  return (
    <div className="pulse-chart">
      {buckets.map((bucket) => {
        const value = bucket.tokens ?? 0;
        const height = Math.max(6, (value / max) * 100);
        const hour = new Date(bucket.hourStart).getHours().toString().padStart(2, '0');
        return (
          <div key={bucket.hourStart} className="pulse-chart-slot" title={`${value} tokens`}>
            <div className={`pulse-bar ${tier(value)}`} style={{ height: `${height}%` }} />
            <span className="pulse-label">{hour}</span>
          </div>
        );
      })}
    </div>
  );
}
