import { useOfficeStore } from '../stores/office-store.js';
import CommitTerrain from '../dashboard/CommitTerrain.jsx';
import PulseChart from '../dashboard/PulseChart.jsx';
import RecentSessions from '../dashboard/RecentSessions.jsx';

export default function RightSidebar() {
  const activityStats = useOfficeStore((s) => s.activityStats);
  const pulseBuckets = useOfficeStore((s) => s.pulseBuckets);
  const recentSessions = useOfficeStore((s) => s.recentSessions);
  const terrainSessions = useOfficeStore((s) => s.terrainSessions);

  return (
    <aside className="sidebar sidebar--right">
      <div className="sidebar-section">
        <h3 className="sidebar-label">Commit Terrain</h3>
        <CommitTerrain sessions={terrainSessions} />
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-label">Activity</h3>
        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-label">ACTIVE</span>
            <span className="metric-value">{activityStats?.activeSessions ?? '—'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">SESSIONS</span>
            <span className="metric-value">{activityStats?.sessionsToday ?? '—'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">FILES</span>
            <span className="metric-value">{activityStats?.filesToday ?? '—'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">COMMITS</span>
            <span className="metric-value">{activityStats?.commitsToday ?? '—'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">ALL TIME</span>
            <span className="metric-value">{activityStats?.allTimeTokens ?? '—'}</span>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-label">System Pulse</h3>
        <PulseChart buckets={pulseBuckets} />
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-label">Recent Sessions</h3>
        <RecentSessions sessions={recentSessions} />
      </div>
    </aside>
  );
}
