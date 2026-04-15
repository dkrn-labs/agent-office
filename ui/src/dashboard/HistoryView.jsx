import { useEffect } from 'react';
import { useOfficeStore } from '../stores/office-store.js';
import OutcomeBadge from './OutcomeBadge.jsx';
import CostFormatter from './CostFormatter.jsx';

const PROVIDER_LABELS = {
  'claude-code': 'Claude',
  codex: 'Codex',
  'gemini-cli': 'Gemini',
};

function formatStarted(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEnded(value) {
  if (!value) return 'Still active';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBoolean(value) {
  if (value == null) return '—';
  return value ? 'yes' : 'no';
}

function providerLabel(providerId) {
  return PROVIDER_LABELS[providerId] ?? providerId ?? '—';
}

export default function HistoryView() {
  const personas = useOfficeStore((s) => s.personas);
  const projects = useOfficeStore((s) => s.projects);
  const historyPage = useOfficeStore((s) => s.historyPage);
  const historyFilters = useOfficeStore((s) => s.historyFilters);
  const historyLoading = useOfficeStore((s) => s.historyLoading);
  const selectedHistorySessionId = useOfficeStore((s) => s.selectedHistorySessionId);
  const historyDetail = useOfficeStore((s) => s.historyDetail);
  const historyDetailLoading = useOfficeStore((s) => s.historyDetailLoading);
  const fetchHistory = useOfficeStore((s) => s.fetchHistory);
  const setHistoryFilters = useOfficeStore((s) => s.setHistoryFilters);
  const openHistorySession = useOfficeStore((s) => s.openHistorySession);
  const closeHistorySession = useOfficeStore((s) => s.closeHistorySession);

  useEffect(() => {
    if (!historyPage) {
      fetchHistory(1);
    }
  }, [historyPage, fetchHistory]);

  const breakdownAvailable =
    historyDetail &&
    historyDetail.providerId !== 'codex' &&
    (
      (historyDetail.tokensIn ?? 0) > 0 ||
      (historyDetail.tokensOut ?? 0) > 0 ||
      (historyDetail.tokensCacheRead ?? 0) > 0 ||
      (historyDetail.tokensCacheWrite ?? 0) > 0
    );

  return (
    <div className="history-view">
      <div className="history-toolbar">
        <div className="history-filter-group">
          <label>
            Persona
            <select
              value={historyFilters.personaId ?? ''}
              onChange={(e) => setHistoryFilters({ personaId: e.target.value || null })}
            >
              <option value="">All</option>
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>{persona.label}</option>
              ))}
            </select>
          </label>
          <label>
            Project
            <select
              value={historyFilters.projectId ?? ''}
              onChange={(e) => setHistoryFilters({ projectId: e.target.value || null })}
            >
              <option value="">All</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <label>
            Outcome
            <select
              value={historyFilters.outcome ?? ''}
              onChange={(e) => setHistoryFilters({ outcome: e.target.value || null })}
            >
              <option value="">All</option>
              <option value="accepted">accepted</option>
              <option value="partial">partial</option>
              <option value="rejected">rejected</option>
              <option value="unknown">unknown</option>
            </select>
          </label>
        </div>
      </div>

      <div className="history-summary">
        <span>{historyPage?.totalItems ?? 0} sessions</span>
      </div>

      <div className="history-table">
        <div className="history-row history-row--head">
          <span>Persona</span>
          <span>Project</span>
          <span>Provider</span>
          <span>Started</span>
          <span>Tokens</span>
          <span>Outcome</span>
        </div>

        {historyLoading && <div className="panel-placeholder">Loading session history…</div>}

        {!historyLoading && (historyPage?.items ?? []).length === 0 && (
          <div className="panel-placeholder">No sessions match the current filters</div>
        )}

        {!historyLoading && (historyPage?.items ?? []).map((session) => (
          <button
            key={session.id}
            type="button"
            className={[
              'history-row',
              selectedHistorySessionId === session.id ? 'history-row--selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => openHistorySession(session.id)}
          >
            <span>{session.personaLabel}</span>
            <span>{session.projectName}</span>
            <span>{providerLabel(session.providerId)}</span>
            <span>{formatStarted(session.startedAt)}</span>
            <span><CostFormatter costUsd={session.costUsd} tokens={session.totalTokens} /></span>
            <span><OutcomeBadge outcome={session.outcome} /></span>
          </button>
        ))}
      </div>

      <div className="history-detail">
        <div className="history-detail-header">
          <div>
            <div className="history-detail-eyebrow">Session Detail</div>
            <h3>
              {historyDetail?.personaLabel ?? 'Select a session'}
              {historyDetail?.projectName ? ` · ${historyDetail.projectName}` : ''}
            </h3>
          </div>
          {historyDetail && (
            <button className="tab-button" type="button" onClick={closeHistorySession}>
              CLEAR
            </button>
          )}
        </div>

        {historyDetailLoading && <div className="panel-placeholder">Loading session detail…</div>}

        {!historyDetailLoading && !historyDetail && (
          <div className="panel-placeholder">
            Pick a session from the table or Recent Sessions to inspect its telemetry.
          </div>
        )}

        {!historyDetailLoading && historyDetail && (
          <>
            <div className="history-detail-grid">
              <div className="history-detail-card">
                <span className="history-detail-label">Outcome</span>
                <OutcomeBadge outcome={historyDetail.outcome} />
              </div>
              <div className="history-detail-card">
                <span className="history-detail-label">Provider</span>
                <span>{providerLabel(historyDetail.providerId)}</span>
              </div>
              <div className="history-detail-card">
                <span className="history-detail-label">Token Cost</span>
                <CostFormatter costUsd={historyDetail.costUsd} tokens={historyDetail.totalTokens} />
              </div>
              <div className="history-detail-card">
                <span className="history-detail-label">Started</span>
                <span>{formatStarted(historyDetail.startedAt)}</span>
              </div>
              <div className="history-detail-card">
                <span className="history-detail-label">Ended</span>
                <span>{formatEnded(historyDetail.endedAt)}</span>
              </div>
              <div className="history-detail-card">
                <span className="history-detail-label">Duration</span>
                <span>{historyDetail.durationSec != null ? `${historyDetail.durationSec}s` : '—'}</span>
              </div>
              <div className="history-detail-card">
                <span className="history-detail-label">Model</span>
                <span>{historyDetail.lastModel ?? '—'}</span>
              </div>
              <div className="history-detail-card">
                <span className="history-detail-label">Commits Produced</span>
                <span>{historyDetail.commitsProduced ?? 0}</span>
              </div>
              <div className="history-detail-card">
                <span className="history-detail-label">Diff Exists</span>
                <span>{formatBoolean(historyDetail.diffExists)}</span>
              </div>
            </div>

            {breakdownAvailable ? (
              <div className="history-token-breakdown">
                <div className="history-detail-card">
                  <span className="history-detail-label">Input</span>
                  <span>{historyDetail.tokensIn ?? 0}</span>
                </div>
                <div className="history-detail-card">
                  <span className="history-detail-label">Output</span>
                  <span>{historyDetail.tokensOut ?? 0}</span>
                </div>
                <div className="history-detail-card">
                  <span className="history-detail-label">Cache Read</span>
                  <span>{historyDetail.tokensCacheRead ?? 0}</span>
                </div>
                <div className="history-detail-card">
                  <span className="history-detail-label">Cache Write</span>
                  <span>{historyDetail.tokensCacheWrite ?? 0}</span>
                </div>
              </div>
            ) : (
              <div className="history-telemetry-note">
                {historyDetail.providerId === 'codex'
                  ? 'Codex sessions currently expose trustworthy total-token telemetry only.'
                  : 'Detailed token breakdown is not available for this session.'}
              </div>
            )}

            <details className="history-diagnostics">
              <summary>Diagnostics</summary>
              <div className="history-detail-grid history-detail-grid--diagnostics">
                <div className="history-detail-card">
                  <span className="history-detail-label">Provider Session</span>
                  <span>{historyDetail.providerSessionId ?? '—'}</span>
                </div>
              </div>
            </details>

            <details className="history-prompt">
              <summary>System Prompt</summary>
              <pre>{historyDetail.systemPrompt ?? '—'}</pre>
            </details>
          </>
        )}
      </div>

      <div className="history-pagination">
        <button
          className="tab-button"
          disabled={!historyPage || historyPage.page <= 1}
          onClick={() => fetchHistory((historyPage?.page ?? 1) - 1)}
        >
          PREV
        </button>
        <span>
          Page {historyPage?.page ?? 1} / {historyPage?.totalPages ?? 1}
        </span>
        <button
          className="tab-button"
          disabled={!historyPage || historyPage.page >= historyPage.totalPages}
          onClick={() => fetchHistory((historyPage?.page ?? 1) + 1)}
        >
          NEXT
        </button>
      </div>
    </div>
  );
}
