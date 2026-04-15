import OutcomeBadge from './OutcomeBadge.jsx';
import CostFormatter from './CostFormatter.jsx';
import { useOfficeStore } from '../stores/office-store.js';

function relativeTime(value) {
  if (!value) return '—';
  const deltaMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(deltaMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function RecentSessions({ sessions = [] }) {
  const openHistorySession = useOfficeStore((s) => s.openHistorySession);

  if (sessions.length === 0) {
    return <div className="panel-placeholder">No recent sessions</div>;
  }

  return (
    <div className="recent-session-list">
      {sessions.map((session) => (
        <button
          key={session.id ?? session.sessionId}
          className="recent-session-row"
          type="button"
          onClick={() => openHistorySession(session.id ?? session.sessionId)}
        >
          <div className="recent-session-main">
            <div className="recent-session-title">
              <span>{session.personaLabel ?? `Persona ${session.personaId}`}</span>
              <OutcomeBadge outcome={session.outcome} />
            </div>
            <div className="recent-session-meta">
              {session.projectName ?? 'Unknown project'} · {relativeTime(session.endedAt ?? session.lastActivity)}
            </div>
          </div>
          <CostFormatter costUsd={session.costUsd ?? session.totals?.costUsd} tokens={session.totalTokens ?? session.totals?.total ?? 0} />
        </button>
      ))}
    </div>
  );
}
