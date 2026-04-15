import { useOfficeStore } from '../stores/office-store.js';
import RecentSessions from '../dashboard/RecentSessions.jsx';

function formatMetricValue(value, kind = 'number') {
  if (value == null) return '—';
  if (kind === 'mtokens') {
    return `${Number(value).toFixed(value >= 10 ? 0 : 1)}M`;
  }
  return String(value);
}

const WINDOW_LABELS = {
  today: 'Today',
  '7d': '7d',
  '30d': '30d',
};

function formatUpdatedAt(timestamp) {
  if (!timestamp) return 'Not yet scanned';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return 'Not yet scanned';
  return `Updated ${parsed.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export default function RightSidebar() {
  const portfolioStats = useOfficeStore((s) => s.portfolioStats);
  const portfolioWindow = useOfficeStore((s) => s.portfolioWindow);
  const setPortfolioWindow = useOfficeStore((s) => s.setPortfolioWindow);
  const fetchPortfolioStats = useOfficeStore((s) => s.fetchPortfolioStats);
  const recentSessions = useOfficeStore((s) => s.recentSessions);
  const currentStats = portfolioStats?.[portfolioWindow] ?? null;

  return (
    <aside className="sidebar sidebar--right">
      <div className="sidebar-section">
        <div className="sidebar-section__header">
          <h3 className="sidebar-label">Portfolio Stats</h3>
          <button
            type="button"
            className="sidebar-link"
            onClick={() => fetchPortfolioStats(true)}
          >
            Refresh
          </button>
        </div>
        <div className="tab-bar">
          {Object.entries(WINDOW_LABELS).map(([window, label]) => (
            <button
              key={window}
              type="button"
              className={`tab-button ${portfolioWindow === window ? 'tab-button--active' : ''}`}
              onClick={() => setPortfolioWindow(window)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-label">REPOS</span>
            <span className="metric-value">{formatMetricValue(currentStats?.repoCount)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">COMMITS</span>
            <span className="metric-value">{formatMetricValue(currentStats?.commitCount)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">FILES</span>
            <span className="metric-value">{formatMetricValue(currentStats?.fileCount)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">SESSIONS</span>
            <span className="metric-value">{formatMetricValue(currentStats?.sessionCount)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">MTOKENS</span>
            <span className="metric-value">
              {formatMetricValue((currentStats?.tokenTotal ?? 0) / 1_000_000, 'mtokens')}
            </span>
          </div>
        </div>
        <p className="sidebar-note">
          Local git activity under your Projects folder, merged with session and token history.
        </p>
        <p className="sidebar-meta">{formatUpdatedAt(currentStats?.computedAt)}</p>
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-label">Recent Sessions</h3>
        <RecentSessions sessions={recentSessions} />
      </div>
    </aside>
  );
}
