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

function providerLabel(providerId) {
  return PROVIDER_LABELS[providerId] ?? providerId ?? '—';
}

function hasTelemetry(d) {
  if (!d) return false;
  return (
    (d.tokensIn ?? 0) > 0 ||
    (d.tokensOut ?? 0) > 0 ||
    (d.tokensCacheRead ?? 0) > 0 ||
    (d.tokensCacheWrite ?? 0) > 0 ||
    (d.totalTokens ?? 0) > 0 ||
    (d.costUsd ?? null) != null ||
    (d.commitsProduced ?? 0) > 0 ||
    d.diffExists != null ||
    (d.outcome ?? null) != null ||
    (d.durationSec ?? null) != null ||
    (d.endedAt ?? null) != null ||
    (d.lastModel ?? null) != null
  );
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

  const telemetryPresent = hasTelemetry(historyDetail);
  const tokenBreakdownAvailable =
    historyDetail &&
    historyDetail.providerId !== 'codex' &&
    ((historyDetail.tokensIn ?? 0) > 0 ||
      (historyDetail.tokensOut ?? 0) > 0 ||
      (historyDetail.tokensCacheRead ?? 0) > 0 ||
      (historyDetail.tokensCacheWrite ?? 0) > 0);

  const hasSummaryContent =
    historyDetail &&
    (historyDetail.summaryRequest ||
      historyDetail.summaryCompleted ||
      historyDetail.summaryNextSteps);

  return (
    <div className="history-view">
      <div className="history-main">
        <div className="history-intro">
          <div className="history-detail-eyebrow">Session History</div>
          <p>Browse past agent runs, inspect what was completed, and follow the trail of observations each persona left behind.</p>
        </div>

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
              Source
              <select
                value={historyFilters.source ?? ''}
                onChange={(e) => setHistoryFilters({ source: e.target.value || null })}
              >
                <option value="">All</option>
                <option value="launcher">launcher</option>
                <option value="provider-hook">provider-hook</option>
                <option value="unassigned">Unassigned</option>
              </select>
            </label>
          </div>
          <div className="history-summary">{historyPage?.totalItems ?? 0} sessions</div>
        </div>

        <div className="history-table">
          <div className="history-row history-row--head">
            <span>Persona</span>
            <span>Project</span>
            <span>Provider</span>
            <span>Started</span>
            <span>Source</span>
            <span>Status</span>
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
              <span>{session.personaLabel ?? 'Unassigned'}</span>
              <span>{session.projectName}</span>
              <span>{providerLabel(session.providerId)}</span>
              <span>{formatStarted(session.startedAt)}</span>
              <span>{session.source ?? '—'}</span>
              <span>{session.status ?? '—'}</span>
            </button>
          ))}
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

      <aside className="history-detail-pane">
        <div className="history-detail-header">
          <div>
            <div className="history-detail-eyebrow">Session Detail</div>
            <h3>
              {historyDetail ? (historyDetail.personaLabel ?? 'Unassigned') : 'Select a session'}
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
          <div className="panel-placeholder history-empty-detail">
            <p>Pick a row on the left to inspect what that agent session did.</p>
            <p className="panel-placeholder-hint">
              You&apos;ll see the completion summary, next steps, telemetry when
              available, and the system prompt that seeded the run.
            </p>
          </div>
        )}

        {!historyDetailLoading && historyDetail && (
          <>
            <div className="history-chip-row">
              <span className="history-chip">{providerLabel(historyDetail.providerId)}</span>
              {historyDetail.source && <span className="history-chip">{historyDetail.source}</span>}
              {historyDetail.status && <span className="history-chip history-chip--status">{historyDetail.status}</span>}
              {historyDetail.outcome && (
                <span className="history-chip"><OutcomeBadge outcome={historyDetail.outcome} /></span>
              )}
            </div>

            {hasSummaryContent ? (
              <section className="history-summary-block">
                <div className="history-section-title">Summary</div>
                {historyDetail.summaryRequest && (
                  <div className="history-summary-line">
                    <span className="history-detail-label">Request</span>
                    <p>{historyDetail.summaryRequest}</p>
                  </div>
                )}
                {historyDetail.summaryCompleted && (
                  <div className="history-summary-line">
                    <span className="history-detail-label">Completed</span>
                    <p>{historyDetail.summaryCompleted}</p>
                  </div>
                )}
                {historyDetail.summaryNextSteps && (
                  <div className="history-summary-line">
                    <span className="history-detail-label">Next Steps</span>
                    <p>{historyDetail.summaryNextSteps}</p>
                  </div>
                )}
              </section>
            ) : (
              <section className="history-summary-block history-summary-block--empty">
                <div className="history-section-title">Summary</div>
                <p className="panel-placeholder-hint">No summary was captured for this session.</p>
              </section>
            )}

            {telemetryPresent ? (
              <section className="history-telemetry-section">
                <div className="history-section-title">Telemetry</div>
                <div className="history-detail-grid">
                  {historyDetail.startedAt && (
                    <div className="history-detail-card">
                      <span className="history-detail-label">Started</span>
                      <span>{formatStarted(historyDetail.startedAt)}</span>
                    </div>
                  )}
                  {historyDetail.endedAt && (
                    <div className="history-detail-card">
                      <span className="history-detail-label">Ended</span>
                      <span>{formatEnded(historyDetail.endedAt)}</span>
                    </div>
                  )}
                  {historyDetail.durationSec != null && (
                    <div className="history-detail-card">
                      <span className="history-detail-label">Duration</span>
                      <span>{historyDetail.durationSec}s</span>
                    </div>
                  )}
                  {historyDetail.lastModel && (
                    <div className="history-detail-card">
                      <span className="history-detail-label">Model</span>
                      <span>{historyDetail.lastModel}</span>
                    </div>
                  )}
                  {((historyDetail.totalTokens ?? 0) > 0 || historyDetail.costUsd != null) && (
                    <div className="history-detail-card">
                      <span className="history-detail-label">Cost</span>
                      <CostFormatter costUsd={historyDetail.costUsd} tokens={historyDetail.totalTokens} />
                    </div>
                  )}
                  {(historyDetail.commitsProduced ?? 0) > 0 && (
                    <div className="history-detail-card">
                      <span className="history-detail-label">Commits</span>
                      <span>{historyDetail.commitsProduced}</span>
                    </div>
                  )}
                  {historyDetail.diffExists != null && (
                    <div className="history-detail-card">
                      <span className="history-detail-label">Diff</span>
                      <span>{historyDetail.diffExists ? 'yes' : 'no'}</span>
                    </div>
                  )}
                </div>

                {tokenBreakdownAvailable && (
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
                )}
              </section>
            ) : (
              <section className="history-telemetry-section history-telemetry-section--empty">
                <div className="history-section-title">Telemetry</div>
                <p className="panel-placeholder-hint">No telemetry was captured for this session.</p>
              </section>
            )}

            <details className="history-diagnostics">
              <summary>Diagnostics</summary>
              <div className="history-detail-grid history-detail-grid--diagnostics">
                <div className="history-detail-card">
                  <span className="history-detail-label">Provider Session</span>
                  <span>{historyDetail.providerSessionId ?? '—'}</span>
                </div>
                <div className="history-detail-card">
                  <span className="history-detail-label">History Session ID</span>
                  <span>{historyDetail.id}</span>
                </div>
              </div>
            </details>

            {historyDetail.systemPrompt && (
              <details className="history-prompt">
                <summary>System Prompt</summary>
                <pre>{historyDetail.systemPrompt}</pre>
              </details>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
