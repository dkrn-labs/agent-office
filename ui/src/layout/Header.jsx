import { useOfficeStore } from '../stores/office-store.js';

export default function Header() {
  const connected = useOfficeStore((s) => s.connected);

  return (
    <header className="dashboard-header">
      <span className="dashboard-title">DKCC</span>
      <span className="dashboard-subtitle">BACK-OFFICE AGENTS · PROJECT OPS</span>
      <div className="dashboard-status">
        <span className={`status-dot ${connected ? 'status-dot--connected' : ''}`} />
        <span className="status-label">{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
    </header>
  );
}
