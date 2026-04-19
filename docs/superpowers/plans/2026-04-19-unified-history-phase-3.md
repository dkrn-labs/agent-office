# Unified History — Phase 3: HistoryView reads `history_session`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the original user-facing gap — "I don't see any history when I
pick this project." Switch the UI from the legacy `session` table to
`history_session`, add an "Unassigned" bucket for rows where `persona_id IS NULL`
(terminal-launched, hook-ingested sessions), and keep telemetry visible for
launcher-paired rows by LEFT JOINing to the legacy `session` table on
`provider_session_id`.

**Architecture:**
- New `repo.listHistorySessionsPage({ page, pageSize, personaId, projectId, source, unassigned })`.
- New `repo.getHistorySessionWithContext(id)` — history_session + latest
  `history_summary` + observations + paired telemetry via LEFT JOIN.
- New routes `GET /api/history/sessions` and `GET /api/history/sessions/:id`
  wired into `historyRoutes(historyStore, { repo })`.
- UI: office-store.fetchHistory/fetchHistorySessionDetail point at new routes.
  `historyFilters` gains `source` and drops `outcome`. HistoryView swaps the
  Outcome filter for Source (All / launcher / provider-hook / Unassigned) and
  renders "Unassigned" when `personaId == null`.
- Legacy `GET /api/sessions*` routes stay intact (Phase 5 retires them).

**Out of scope:** Telemetry column migration (Phase 4), `session` deprecation
(Phase 5).

---

## File Structure

**Modify:**
- `src/db/repository.js` — add `listHistorySessionsPage`, `getHistorySessionWithContext`, export both.
- `src/api/routes/history.js` — add two GET routes; accept `repo` in the factory signature.
- `src/api/index.js` (or wherever `historyRoutes` is wired) — pass `repo`.
- `ui/src/stores/office-store.js` — swap URLs, add `source` to filters, drop `outcome`.
- `ui/src/dashboard/HistoryView.jsx` — swap filter, columns, and detail rendering.

**Create:**
- `test/api/history-sessions.test.js` — GET list + detail + filters.

---

## Task 1: Repo methods

- [ ] Add `listHistorySessionsPage` with LEFT JOINs to `persona`, `project`,
      legacy `session` (on provider_id+provider_session_id), and a lateral/
      correlated subquery pulling the most recent `history_summary` fields.
      `unassigned=true` → `hs.persona_id IS NULL`; otherwise `personaId` filter
      applies when present. `source` filter is string equality.
- [ ] Add `getHistorySessionWithContext(id)` returning
      `{ ...historySession, projectName, projectPath, personaLabel, telemetry, summary, observations }`.
- [ ] Commit.

## Task 2: API routes

- [ ] `GET /api/history/sessions` — query params: `page`, `pageSize`,
      `personaId`, `projectId`, `source`, `unassigned` (`1`/`true`). Returns
      `{ page, pageSize, totalItems, totalPages, items }`.
- [ ] `GET /api/history/sessions/:id` — returns `getHistorySessionWithContext`
      result or 404.
- [ ] Wire `repo` into the `historyRoutes(historyStore, { repo })` factory at
      app boot.
- [ ] Test with `supertest` or existing test harness: list includes a
      launcher-created row; `unassigned=1` returns hook-only rows with
      `personaLabel=null`; detail merges summary + telemetry when paired.
- [ ] Commit.

## Task 3: UI swap

- [ ] `office-store.js`: update `historyFilters` default to
      `{ personaId: null, projectId: null, source: null }`; `fetchHistory`
      calls `/api/history/sessions` with the new params (map `source === 'unassigned'`
      to `unassigned=1`); `fetchHistorySessionDetail` calls
      `/api/history/sessions/:id`.
- [ ] `HistoryView.jsx`:
  - Replace Outcome filter with Source filter (All, launcher, provider-hook,
    Unassigned).
  - Persona column shows "Unassigned" when `session.personaLabel` is null.
  - Detail: keep existing telemetry cards (they'll be populated from the
    LEFT JOIN when available; degrade to `—` otherwise). Add a
    "Latest Summary" section rendering `summary.completed` /
    `summary.nextSteps` when present.
- [ ] Manual verification: start backend, load UI, pick the current project —
      sessions appear. Switch Source filter to Unassigned — hook-only rows
      appear. Click a row, detail panel populates.
- [ ] Commit.

## Task 4: Roadmap update

- [ ] Mark Phase 3 ✅ in `unified-history-roadmap.md`.
- [ ] Commit.
