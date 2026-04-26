/**
 * OutcomePrompt — bottom-of-screen banner asking the operator to mark
 * the outcome of recently-ended sessions.
 *
 * Feeds the heuristic's defer-to-operator gate (see
 * src/api/server.js + src/agents/preflight-quota.js notes). Operator
 * click hits POST /api/sessions/:id/outcome, which sets
 * outcome_source='operator'; the heuristic then skips that row.
 *
 * Visual: stacked cards (one per pending session), 3 buttons each,
 * dismiss-X in the corner. No modal — non-blocking.
 */

import { useOfficeStore } from '../stores/office-store.js';

function basename(path) {
  if (!path) return '';
  const parts = String(path).split('/');
  return parts[parts.length - 1] || path;
}

async function postOutcome(historySessionId, outcome) {
  const res = await fetch(`/api/sessions/${historySessionId}/outcome`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outcome }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export default function OutcomePrompt() {
  const awaitingOutcomes = useOfficeStore((s) => s.awaitingOutcomes);
  const dismissAwaitingOutcome = useOfficeStore((s) => s.dismissAwaitingOutcome);

  if (!awaitingOutcomes || awaitingOutcomes.length === 0) return null;

  return (
    <div className="outcome-prompt">
      {awaitingOutcomes.map((entry) => (
        <div key={entry.historySessionId} className="outcome-prompt__card">
          <div className="outcome-prompt__title">
            How did session #{entry.historySessionId} go?
            {entry.projectPath && <span className="outcome-prompt__project"> · {basename(entry.projectPath)}</span>}
          </div>
          <div className="outcome-prompt__buttons">
            <button
              type="button"
              className="outcome-prompt__btn outcome-prompt__btn--accepted"
              onClick={() => postOutcome(entry.historySessionId, 'accepted')
                .then(() => dismissAwaitingOutcome(entry.historySessionId))
                .catch((err) => console.warn('[outcome]', err.message))}
            >
              Accepted
            </button>
            <button
              type="button"
              className="outcome-prompt__btn outcome-prompt__btn--partial"
              onClick={() => postOutcome(entry.historySessionId, 'partial')
                .then(() => dismissAwaitingOutcome(entry.historySessionId))
                .catch((err) => console.warn('[outcome]', err.message))}
            >
              Partial
            </button>
            <button
              type="button"
              className="outcome-prompt__btn outcome-prompt__btn--rejected"
              onClick={() => postOutcome(entry.historySessionId, 'rejected')
                .then(() => dismissAwaitingOutcome(entry.historySessionId))
                .catch((err) => console.warn('[outcome]', err.message))}
            >
              Rejected
            </button>
            <button
              type="button"
              className="outcome-prompt__close"
              aria-label="Dismiss — heuristic will classify after the grace window"
              title="Dismiss — heuristic will classify after the grace window"
              onClick={() => dismissAwaitingOutcome(entry.historySessionId)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
