export default function RightSidebar() {
  return (
    <aside className="sidebar sidebar--right">
      <div className="sidebar-section">
        <h3 className="sidebar-label">Commit Terrain</h3>
        <div className="panel-placeholder panel-placeholder--tall">—</div>
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-label">Activity</h3>
        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-label">SESSIONS</span>
            <span className="metric-value">—</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">FILES</span>
            <span className="metric-value">—</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">COMMITS</span>
            <span className="metric-value">—</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">ALL TIME</span>
            <span className="metric-value">—</span>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-label">System Pulse</h3>
        <div className="pulse-chart">
          {[40, 25, 55, 70, 30, 45].map((h, i) => (
            <div key={i} className="pulse-bar" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-label">Skills</h3>
        <div className="panel-placeholder">skill badges</div>
      </div>
    </aside>
  );
}
