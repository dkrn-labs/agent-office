import { useMemo, useState } from 'react';
import { useOfficeStore } from '../stores/office-store.js';

const PROVIDER_LABELS = {
  'claude-code': 'Claude',
  codex: 'Codex',
  'gemini-cli': 'Gemini',
};

function formatRelative(isoOrDate) {
  if (!isoOrDate) return 'no activity';
  const then = new Date(isoOrDate).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (deltaSec < 60) return 'just now';
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}

function formatTokens(total) {
  if (!Number.isFinite(total) || total <= 0) return '0 tok';
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M tok`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k tok`;
  return `${total} tok`;
}

function sessionStatus(session) {
  if (session?.working) return { label: 'LIVE', tone: 'live' };
  if (session?.sessionId) return { label: 'IDLE', tone: 'idle' };
  return { label: 'READY', tone: 'ready' };
}

function providerLabel(providerId) {
  return PROVIDER_LABELS[providerId] ?? 'Ready';
}

export default function OfficeStatePanel() {
  const personas = useOfficeStore((s) => s.personas);
  const sessions = useOfficeStore((s) => s.sessions);
  const connected = useOfficeStore((s) => s.connected);
  const openPicker = useOfficeStore((s) => s.openPicker);
  const [collapsed, setCollapsed] = useState(false);

  const roster = useMemo(
    () =>
      personas.map((persona) => {
        const session = sessions[persona.id] ?? null;
        return {
          persona,
          session,
          status: sessionStatus(session),
        };
      }),
    [personas, sessions],
  );

  return (
    <section className={`office-state-panel ${collapsed ? 'office-state-panel--collapsed' : ''}`}>
      <div className="office-state-panel__header">
        <div>
          <p className="office-state-panel__eyebrow">Office State</p>
          <p className="office-state-panel__title">Live operator view</p>
        </div>
        <div className="office-state-panel__actions">
          <span className={`office-state-connection office-state-connection--${connected ? 'live' : 'stale'}`}>
            {connected ? 'live feed' : 'reconnecting'}
          </span>
          <button
            type="button"
            className="office-state-toggle"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>

      <div className="office-state-grid">
        {roster.map(({ persona, session, status }) => (
          <button
            key={persona.id}
            type="button"
            className={`office-state-card office-state-card--${status.tone}`}
            onClick={() => openPicker(persona.id)}
          >
            <div className="office-state-card__topline">
              <span className={`office-state-pill office-state-pill--${status.tone}`}>
                {status.label}
              </span>
              <span className="office-state-card__age">
                {formatRelative(session?.lastActivity ?? session?.startedAt)}
              </span>
            </div>

            <div className="office-state-card__identity">
              <span className="office-state-card__name">{persona.label}</span>
              <span className="office-state-card__domain">{persona.domain}</span>
            </div>

            <p className="office-state-card__project" title={session?.projectPath ?? ''}>
              {session?.projectName ?? 'Ready to launch'}
            </p>

            <div className="office-state-card__meta">
              <span className={`office-state-provider office-state-provider--${session?.providerId ?? 'ready'}`}>
                {providerLabel(session?.providerId)}
              </span>
              <span>{session?.lastModel ?? 'awaiting model'}</span>
              <span>{formatTokens(session?.totals?.total ?? 0)}</span>
            </div>
            {session?.providerId === 'codex' && (
              <p className="office-state-card__note">total-only telemetry</p>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
