// Persona brief generator.
//
// A brief is a compact markdown summary of the observations most relevant to
// a given (persona, project) context. It is what we actually inject into a
// session's initial prompt — NOT the raw memory dump.
//
// Selection strategy:
//   1. Hard scope: filter to (project_id, persona_id) if provided.
//   2. Seed with the N most recent observations (recency bias).
//   3. Expand with the top-K semantically-similar observations to a query
//      derived from the persona+project context (diversity bias).
//   4. Dedupe, truncate each, keep the total under the token budget.
//
// The selection is stable: same DB state → same brief. That property is what
// lets us benchmark raw vs brief deterministically.

import { searchSimilar } from './embed-store.js';
import { embed } from './embeddings.js';

// Simple token-estimator: ≈ 4 characters per token for English + code.
// This is intentionally coarse; the actual provider will count precisely.
// What matters for the benchmark is a consistent measure across raw and brief.
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text, budget) {
  if (estimateTokens(text) <= budget) return text;
  const charBudget = Math.max(40, budget * 4 - 20);
  return text.slice(0, charBudget).trimEnd() + ' …';
}

function observationLine(obs, perObsBudget) {
  const when = obs.created_at ? obs.created_at.slice(0, 10) : '';
  const kind = (obs.type ?? 'note').toLowerCase();
  const title = obs.title ?? '(untitled)';
  const narrative = obs.narrative ? ` — ${obs.narrative}` : '';
  const raw = `- [${when} · ${kind}] **${title}**${narrative}`;
  return truncateToTokens(raw, perObsBudget);
}

/**
 * Return the raw memory as a markdown list (the "no brief" baseline that the
 * benchmark compares against). Scoped to project + persona if given.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{projectId?: number, personaId?: number|null}} scope
 */
export function getRawMemory(db, { projectId, personaId } = {}) {
  const params = [];
  const filters = [];
  if (projectId != null) { filters.push('obs.project_id = ?'); params.push(projectId); }
  if (personaId != null) { filters.push('sess.persona_id = ?'); params.push(personaId); }

  const rows = db.prepare(`
    SELECT obs.* FROM history_observation obs
    JOIN history_session sess ON sess.history_session_id = obs.history_session_id
    ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    ORDER BY obs.created_at_epoch DESC
  `).all(...params);

  const lines = rows.map((r) => observationLine(r, 400));
  return lines.join('\n');
}

/**
 * Build a persona-scoped brief under a token budget.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {number} [opts.projectId]
 * @param {number|null} [opts.personaId]
 * @param {string} [opts.queryText]   Optional seed for semantic retrieval.
 *                                     Defaults to "What has happened on this project lately".
 * @param {number} [opts.budgetTokens=1000]
 * @param {number} [opts.recentCount=8]
 * @param {number} [opts.semanticCount=12]
 */
export async function getPersonaBrief(db, {
  projectId,
  personaId = null,
  queryText,
  budgetTokens = 1000,
  recentCount = 8,
  semanticCount = 12,
} = {}) {
  const params = [];
  const filters = [];
  if (projectId != null) { filters.push('obs.project_id = ?'); params.push(projectId); }
  if (personaId != null) { filters.push('sess.persona_id = ?'); params.push(personaId); }

  // 1. Recent seed.
  const recent = db.prepare(`
    SELECT obs.* FROM history_observation obs
    JOIN history_session sess ON sess.history_session_id = obs.history_session_id
    ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    ORDER BY obs.created_at_epoch DESC
    LIMIT ?
  `).all(...params, recentCount);

  const chosen = new Map();
  for (const r of recent) chosen.set(r.history_observation_id, { obs: r, reason: 'recent' });

  // 2. Semantic expansion (skips silently if embeddings aren't ready).
  try {
    const seed = queryText ??
      `Recent work, decisions and issues on this project. Priorities and open threads.`;
    const { vector } = await embed(seed);
    const hits = searchSimilar(db, vector, { k: semanticCount, projectId, personaId });
    if (hits.length > 0) {
      const placeholders = hits.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT * FROM history_observation WHERE history_observation_id IN (${placeholders})`,
      ).all(...hits.map((h) => h.observationId));
      const byId = new Map(rows.map((r) => [r.history_observation_id, r]));
      for (const h of hits) {
        const obs = byId.get(h.observationId);
        if (obs && !chosen.has(obs.history_observation_id)) {
          chosen.set(obs.history_observation_id, { obs, reason: 'semantic' });
        }
      }
    }
  } catch (err) {
    // Embedding path failed (no model, no vec extension, etc). Fall back to recency only.
    console.warn('[brief] semantic expansion skipped:', err.message);
  }

  // 3. Order by recency, then format under budget.
  const ordered = [...chosen.values()].sort(
    (a, b) => (b.obs.created_at_epoch ?? 0) - (a.obs.created_at_epoch ?? 0),
  );

  const header = '## Project brief\n';
  const headerTokens = estimateTokens(header);
  const remaining = budgetTokens - headerTokens;

  const perObsBudget = Math.max(60, Math.floor(remaining / Math.max(ordered.length, 1)));
  const lines = [];
  let used = 0;
  for (const { obs } of ordered) {
    const line = observationLine(obs, perObsBudget);
    const lineTokens = estimateTokens(line) + 1;
    if (used + lineTokens > remaining) break;
    lines.push(line);
    used += lineTokens;
  }

  return {
    markdown: header + lines.join('\n'),
    usedTokens: headerTokens + used,
    budgetTokens,
    sourceCount: lines.length,
    candidateCount: ordered.length,
  };
}
