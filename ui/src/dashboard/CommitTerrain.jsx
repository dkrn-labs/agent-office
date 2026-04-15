import { useOfficeStore } from '../stores/office-store.js';
import { formatTokens } from './CostFormatter.jsx';

const OUTCOME_CLASS = {
  accepted: 'commit-terrain-bar--accepted',
  partial: 'commit-terrain-bar--partial',
  rejected: 'commit-terrain-bar--rejected',
  unknown: 'commit-terrain-bar--unknown',
};

function relativeEnded(value) {
  if (!value) return 'active';
  const deltaMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(deltaMs / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function CommitTerrain({ sessions = [] }) {
  const openHistorySession = useOfficeStore((s) => s.openHistorySession);

  if (sessions.length === 0) {
    return <div className="panel-placeholder panel-placeholder--tall">No finished sessions yet</div>;
  }

  const maxTokens = Math.max(...sessions.map((session) => session.totalTokens ?? 0), 1);
  const totalTokens = sessions.reduce((sum, session) => sum + (session.totalTokens ?? 0), 0);
  const totalCommits = sessions.reduce((sum, session) => sum + (session.commitsProduced ?? 0), 0);

  return (
    <div className="commit-terrain">
      <div className="commit-terrain-skyline">
        {sessions.map((session) => {
          const total = session.totalTokens ?? 0;
          const height = Math.max(12, Math.round((total / maxTokens) * 112));
          return (
            <button
              key={session.id ?? session.sessionId}
              type="button"
              className="commit-terrain-column"
              onClick={() => openHistorySession(session.id ?? session.sessionId)}
              title={`${session.personaLabel ?? 'Session'} · ${session.projectName ?? 'Unknown project'} · ${formatTokens(total)} tokens`}
            >
              <span className="commit-terrain-age">{relativeEnded(session.endedAt ?? session.startedAt)}</span>
              <span
                className={[
                  'commit-terrain-bar',
                  OUTCOME_CLASS[session.outcome] ?? OUTCOME_CLASS.unknown,
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ height: `${height}px` }}
              />
              <span className="commit-terrain-label">
                {(session.personaLabel ?? 'S').slice(0, 3).toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>

      <div className="commit-terrain-legend">
        <span>{sessions.length} recent</span>
        <span>{formatTokens(totalTokens)} tokens</span>
        <span>{totalCommits} commits</span>
      </div>
    </div>
  );
}
