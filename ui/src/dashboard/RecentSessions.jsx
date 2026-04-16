import OutcomeBadge from './OutcomeBadge.jsx';
import { formatTokens } from './CostFormatter.jsx';
import { useOfficeStore } from '../stores/office-store.js';
import { getSessionPresence, useSessionClock } from '../lib/session-status.js';

const PROVIDER_LABELS = {
  'claude-code': 'Claude',
  codex: 'Codex',
  'gemini-cli': 'Gemini',
};

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
  const resumeSession = useOfficeStore((s) => s.resumeSession);
  const resumingSessionId = useOfficeStore((s) => s.resumingSessionId);
  const now = useSessionClock();

  if (sessions.length === 0) {
    return <div className="panel-placeholder">No recent sessions</div>;
  }

  return (
    <div className="recent-session-list">
      {sessions.map((session) => {
        const sessionId = session.id ?? session.sessionId;
        const canResume = Boolean(session.personaId && session.projectId);
        const isResuming = resumingSessionId === sessionId;
        const presence = getSessionPresence(session, now);
        const isActive = !session.endedAt && session.sessionId;

        return (
          <article key={sessionId} className="recent-session-row">
            <button
              className="recent-session-card"
              type="button"
              onClick={() => openHistorySession(sessionId)}
            >
              <div className="recent-session-main">
                <div className="recent-session-title-text">
                  {session.personaLabel ?? `Persona ${session.personaId}`}
                </div>
                <div className="recent-session-meta">
                  {session.projectName ?? 'Unknown project'} · {relativeTime(session.endedAt ?? session.lastActivity)}
                </div>
                <div className="recent-session-tags">
                  <span className="recent-session-provider">
                    {PROVIDER_LABELS[session.providerId] ?? session.providerId ?? 'Provider'}
                  </span>
                  <OutcomeBadge outcome={session.outcome} />
                  {isActive ? (
                    <span
                      className={`recent-session-presence recent-session-presence--${presence}`}
                    >
                      {presence === 'live' ? 'Live' : 'Idle'}
                    </span>
                  ) : null}
                </div>
                <div className="recent-session-tokens">
                  {formatTokens(session.totalTokens ?? session.totals?.total ?? 0)} tokens
                </div>
              </div>
            </button>
            <button
              className="recent-session-play"
              type="button"
              disabled={!canResume || isResuming}
              onClick={() => {
                void resumeSession(session);
              }}
              aria-label={`Resume ${session.personaLabel ?? `persona ${session.personaId}`}`}
              title={canResume ? 'Resume this session context' : 'Session cannot be resumed'}
            >
              {isResuming ? '...' : '>'}
            </button>
          </article>
        );
      })}
    </div>
  );
}
