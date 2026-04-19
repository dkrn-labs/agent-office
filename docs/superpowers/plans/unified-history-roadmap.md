# Unified History — Roadmap & Contract

Living index of the five-phase refactor that collapses the parallel `session` /
`history_session` tables into one provider-neutral stream, fixes persona
tagging, and makes the UI read directly from `history_session`.

Each phase ships as its own plan file and its own PR(s). This document is the
contract: it names the phase, its goal, the files in/out of scope, and the exit
criteria. Update the status column as phases land so future contributors can
pick up without re-reading the whole conversation.

## Phase Status

| Phase | Title                                       | Status      | Plan                                                |
|-------|---------------------------------------------|-------------|-----------------------------------------------------|
| 1     | Launcher-owned `history_session`            | ✅ Shipped  | `2026-04-19-unified-history-phase-1.md`             |
| 2     | Ingest writes through one path              | ✅ Shipped  | `2026-04-19-unified-history-phase-2.md`             |
| 3     | HistoryView reads `history_session`         | ✅ Shipped  | `2026-04-19-unified-history-phase-3.md`             |
| 4     | Telemetry columns on `history_session`      | ✅ Shipped  | `2026-04-19-unified-history-phase-4.md`             |
| 5a    | Shim stats onto `history_session*`          | ✅ Shipped  | `2026-04-19-unified-history-phase-5a.md`            |
| 5b    | Deprecate `session` table                   | ⏳ Pending  | _TBD_                                               |

---

## Phase 1 — Launcher-owned `history_session` ✅

**Goal:** Make the launcher the authoritative creator of a `history_session`
row (persona tagged, `source='launcher'`). The provider hook upserts into that
row via `historySessionId` instead of creating a duplicate.

**Exit criteria (met):**
- Launcher pre-creates `history_session` before terminal spawn.
- `AGENT_OFFICE_HISTORY_SESSION_ID` exported to the child shell.
- Hook forwards `historySessionId` end-to-end; `historyStore.ingest()` upserts.
- Launcher-authoritative fields (`source`, `systemPrompt`) survive the hook.
- 7 commits on `main`, verified in production DB.

---

## Phase 2 — Ingest writes through one path 🚧

**Goal:** Remove the launcher's direct `repo.createHistorySession(...)` call
and route the pre-create through a new `historyStore.createLaunch()` helper.
No behavior change, but all `history_session` writes (launcher + hook) now go
through the history store module — a prerequisite for Phase 3's list endpoint
and Phase 4's telemetry columns.

**In scope:**
- `src/history/project-history.js` — new `createLaunch({ ... })`.
- `src/agents/launcher.js` — call `projectHistory.createLaunch()` instead of
  `repo.createHistorySession()` directly.
- `test/history/create-launch.test.js` — unit test.

**Out of scope:** API endpoints, UI, telemetry columns, `session` deprecation.

**Exit criteria:**
- `launcher.js` contains zero direct `repo.createHistorySession` references.
- Existing Phase 1 tests stay green.
- New test asserts `createLaunch` returns an integer id and stores
  `source='launcher'`, `status='in-progress'`, persona tagged.

---

## Phase 3 — HistoryView reads `history_session` ⏳

**Goal:** Close the original user-facing gap: "I don't see any history when I
pick this project." Switch the UI from the legacy `session` table to
`history_session` and surface an "Unassigned" bucket for rows where
`persona_id IS NULL` (terminal-launched sessions caught by the hook).

**In scope (anticipated):**
- `GET /api/history/sessions` — paginated list with persona/project/source
  filters + "Unassigned" virtual bucket.
- `ui/src/dashboard/HistoryView.jsx` + `ui/src/stores/office-store.js` swap
  data source.
- Detail panel reads summaries/observations keyed on `historySessionId`.

**Exit criteria:**
- HistoryView lists every ingested `history_session` for the selected project.
- "Unassigned" filter chip shows terminal-launched rows.
- Legacy `GET /api/projects/:id/sessions` kept intact for now (Phase 5 removes).

---

## Phase 4 — Telemetry columns on `history_session` ⏳

**Goal:** Move token/cost/commit/diff/outcome telemetry off the legacy
`session` row onto `history_session` (or a sibling `history_session_metrics`
table) so dashboards can read one source.

**In scope (anticipated):**
- Migration adding telemetry columns.
- Backfill from `session` rows where `providerSessionId` matches.
- Aggregator + stats endpoints read from new home.

**Exit criteria:**
- Dashboard tiles match pre-migration values for the last 30 days.
- Telemetry watcher writes land on `history_session`.

---

## Phase 5 — Deprecate `session` ⏳

**Goal:** Retire the legacy `session` table and its repo methods.

**In scope (anticipated):**
- Read-only shim for one release — legacy endpoints serve from
  `history_session`.
- Drop `session` table + `createSession` / `updateSession` / `listSessionsPage`
  repo methods.
- Delete `SESSION_STARTED` consumers that still assume the old shape.

**Exit criteria:**
- `grep -r "repo.createSession\|listSessionsPage" src` returns zero matches.
- Migration removes the `session` table.
- Full suite green; UI identical.

---

## Cross-phase invariants

- `history_session.source` is write-once (first writer wins: launcher > hook).
- `persona_id` is authoritative from the launcher; never overwritten by the
  hook unless stored value is null.
- Every new `history_session` write path must flow through
  `historyStore` — no direct `repo.createHistorySession` outside the store
  after Phase 2.
- All phases preserve existing test suites; no phase may break the prior.
