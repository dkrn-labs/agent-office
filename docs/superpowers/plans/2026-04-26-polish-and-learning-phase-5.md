# Polish & learning — Phase 5 (P5, focused subset)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`
> to walk this plan task-by-task. Steps use `- [ ]` checkboxes for tracking.
>
> **Test discipline:** during the TDD inner loop run `npm run test:unit`
> (sub-second). Only run `npm run test:integration` at task-exit.

**Goal.** Land the four P5 items that together close two open product
questions:

1. **"Is the frontdesk LLM stage actually good enough to flip on by
   default?"** — answered by the 20-task acceptance benchmark
   (Track B) running against the routing pipeline.
2. **"Do we have enough operational signal to let someone else run
   this?"** — answered by observability primitives (Track A) and
   operator-confirmed outcomes (Track C) feeding a real learning
   loop (Track D).

The remaining P5 items (gh-bridge ticker, persona evolution, session
share, sprite animations) ship opportunistically later — they're each
≤1 day and don't gate any product decision.

**Trigger.** P4 shipped (abtop-bridge, image paste). The frontdesk
LLM stage works behind `frontdesk.llm.enabled` but the default is
still `false` because we don't have empirical evidence it routes
correctly across a representative task set. P5 in this scope is the
evidence.

**Architecture references.**
- `docs/architecture/implementation-plan.md` §P5 (rolling list).
- `docs/superpowers/plans/2026-04-26-frontdesk-llm-phase-2.md`
  acceptance section — defines the 20-task gate.
- `docs/superpowers/plans/2026-04-26-multi-provider-phase-3.md`
  exit checklist — the matrix this benchmark complements.
- `docs/experiments/2026-04-26-frontdesk-llm-local.md` — current
  bench shape (5 tasks, schema/latency only). The 20-task harness
  extends that with *correctness* scoring.

**Tech stack.** Node 22 ESM · `node:test` · existing Fastify + ws-bus
+ better-sqlite3. New runtime dep: `pino` (structured logger). No new
UI deps.

**Out of scope (deferred to opportunistic P5 wave 2).**
- P5-1 `gh-bridge` for project-activity ticker.
- P5-4 persona-evolution offline mining job.
- P5-6 read-only session share.
- P5-7 sprite ambient animations on `/legacy`.
- P3 carry-over: A6 drawer-timeline UI (pairs with whichever next
  dashboard work happens).

---

## File Structure

**Create:**
- `src/api/routes/health.js` — `GET /api/_health` returns liveness
  + readiness JSON.
- `src/api/routes/metrics.js` — `GET /api/_metrics` returns
  structured JSON counters; Prometheus text format added behind a
  query param when needed (P6 distribution may bind it).
- `src/core/logger.js` — pino instance with sensible defaults; the
  one place we configure log level + redaction.
- `bench/frontdesk-acceptance/tasks.json` — the 20-task fixture set.
- `bench/frontdesk-acceptance/run.mjs` — benchmark runner.
- `bench/frontdesk-acceptance/report.md` — markdown report (regenerated
  by each run).
- `src/api/routes/session-outcome.js` — `POST /api/sessions/:id/outcome`.
- `ui/src/dashboard/OutcomePrompt.jsx` — modal/banner that asks the
  operator to classify a finished session.
- `src/frontdesk/few-shot.js` — pure helper:
  `buildFewShotBlock(decisions)` returns the cached prompt block.
- `test/api/health.test.js`, `test/api/metrics.test.js`,
  `test/api/session-outcome.test.js`,
  `test/frontdesk/few-shot.test.js` — integration / unit.

**Modify:**
- `src/api/server.js` — register the four new routes; init the pino
  logger; pass it down to existing `log` consumers via
  `app.locals.logger`.
- `src/db/repository.js` — add `listRecentAcceptedDecisions(sinceEpoch, limit)`.
- `src/frontdesk/prompt.js` — fold the few-shot block into
  `buildPrompt`, between persona-catalog and skill-catalog.
- `src/telemetry/outcome-inference.js` — keep heuristic; gate it
  behind a "no-operator-click-within-Ns" timer so operator outcome
  always wins.
- `src/core/settings.js` — add `frontdesk.llm.fewShot.{ enabled,
  windowHours, count, minSampleSize }`.
- `bin/agent-office.js` — `agent-office bench frontdesk-acceptance`
  subcommand wraps `run.mjs`.

**Delete:** Nothing.

---

## Tasks

### Track A — Observability (P5-5)

#### A1 — `GET /api/_health`
- [ ] Returns `{ status: 'ok', uptime: <s>, version: <pkg.version>,
  db: 'reachable'|'unreachable', dataDir: <path> }`. Liveness +
  readiness combined; the docker-compose `healthcheck:` directive
  binds to this.
- [ ] HTTP 200 when healthy, 503 when DB read fails.
- [ ] **Test (integration):** boot fastify with a fake repo + temp
  DB; assert healthy and unhealthy responses.

#### A2 — `GET /api/_metrics`
- [ ] JSON shape: `{ sessions: { live, byProvider }, frontdesk:
  { decisionsToday, fallbackRate7d }, savings: { savedDollarsToday,
  savedTokens7d }, abtop: { reachable, lastTickEpoch }, watchers:
  { claude: { sessionsTracked }, codex: {...}, gemini: {...} } }`.
- [ ] Optional `?format=prometheus` returns text-format. Reasonable
  metric names (`agent_office_sessions_live`, etc.).
- [ ] **Test (integration):** seed a fake repo + bus state; assert
  both shapes.

#### A3 — Structured logger (pino)
- [ ] `npm install pino`. `src/core/logger.js` wraps it with redaction
  for known secret-shaped strings (reuse the `redactSecrets` regex
  set from `src/telemetry/abtop-parser.js`).
- [ ] Replace ad-hoc `console.log` / `log.info(...)` call sites with
  the pino instance. Keep the existing `{ warn, info }` shape so
  callers don't notice the swap; under the hood it routes through
  `logger.info` / `logger.warn`.
- [ ] **Test (unit):** logger unit test confirms redaction is applied
  and that level filtering works.

#### A4 — Log-rotation policy
- [ ] No filesystem rotation in P5 — `docker logs` is the canonical
  viewer for the upcoming P6 distribution path, and the dev install
  has Node's stdout. Document this in `docs/distribution/observability.md`.
- [ ] Add a startup warning when the process is detected to be
  writing to a redirected file (>10 MB) without `LOG_ROTATE_PATH`
  configured, suggesting docker-logs / pino-tee. No behavior change,
  just a flag.

### Track B — 20-task acceptance benchmark (P2 carry-over)

#### B1 — `bench/frontdesk-acceptance/tasks.json`
- [ ] 20 tasks spanning the rule space:
  - 4 debug/bug-fix (R9 verb-bias)
  - 4 refactor / cross-codebase (long-running)
  - 4 mechanical oneshot (R10 — rename, format, comment)
  - 2 deploy/release (R8 devops restriction)
  - 2 frontend/UI
  - 2 secret-handling (R2 mustBeLocal)
  - 2 strict-privacy (R3 mustBeLocal)
- [ ] Each task: `{ id, prompt, expected: { personaDomain, providerKind,
  taskType, mustBeLocal? } }`. Persona is named by *domain* not exact
  label so the test is stable across user persona-catalog tweaks.

#### B2 — `bench/frontdesk-acceptance/run.mjs`
- [ ] Spins up a temp DB + repo, seeds default personas, registers
  default providers via the manifest. Posts each task through
  `route(...)` directly (no Fastify needed — keeps the benchmark a
  one-binary thing).
- [ ] Scoring: per-task `pass`/`fail` against the expected fields.
  Persona match = pick.persona.domain matches expected domain.
  Provider match = pick.provider.kind matches.
- [ ] Exit code 0 when ≥18/20 pass; non-zero otherwise.

#### B3 — `bench/frontdesk-acceptance/report.md` writer
- [ ] Renders a markdown table with one row per task: id, expected,
  got, pass/fail. Aggregate counts at the top.
- [ ] Run via `node bench/frontdesk-acceptance/run.mjs --report
  bench/frontdesk-acceptance/report.md`. Default behavior just
  prints to stdout when `--report` is omitted.

#### B4 — `agent-office bench frontdesk-acceptance` subcommand
- [ ] `bin/agent-office.js`: thin wrapper that invokes `run.mjs`.
  Required for the README's "verify your install" story and for
  CI later.
- [ ] **No automated test for the bench itself** — the bench *is*
  the test. CI will run `node bench/frontdesk-acceptance/run.mjs`
  on PRs touching `src/frontdesk/**` once a follow-up GitHub Actions
  job is added; that job is out of scope for this plan.

#### B5 — Conditional default flip
- [ ] *After* B2/B3 produce ≥18/20 pass on a real run, change
  `getDefaultSettings()` so `frontdesk.llm.enabled = true` by default.
- [ ] If <18/20, file an issue with the failing rows, leave the
  default at `false`, and ship the rest of P5 anyway.

### Track C — Outcome prompt UI (P5-2)

#### C1 — `POST /api/sessions/:id/outcome`
- [ ] Body: `{ outcome: 'accepted'|'partial'|'rejected' }`.
- [ ] Updates `history_session.outcome` directly. Records
  `outcome_source = 'operator'` so the inference path can defer
  to it. Emits `session:outcome:updated` on ws-bus.
- [ ] **Test (integration):** post the route, assert DB + event.

#### C2 — `outcome-inference` defer-to-operator gate
- [ ] When the watcher's `session:expired` would fire `inferOutcome`,
  first check `repo.getHistorySession(id).outcomeSource`. If it's
  `'operator'`, skip the heuristic.
- [ ] Wait `OPERATOR_OUTCOME_GRACE_MS = 120_000` after `session:expired`
  before running the heuristic — the operator may still be looking at
  the prompt.
- [ ] **Test (unit):** assert grace window honored; assert operator
  source skips the heuristic.

#### C3 — `OutcomePrompt.jsx` modal/banner
- [ ] Listens on the WS topic `session:awaiting-outcome` (emitted at
  the same time as `session:expired`). Shows a small banner asking
  "How did session #N go?" with three buttons.
- [ ] Click → `POST /api/sessions/:id/outcome` → banner dismisses.
- [ ] Manual smoke (no UI test harness yet — same convention as
  P4-B).

#### C4 — Settings flag
- [ ] `settings.outcomePrompt.{ enabled: true, gracePeriodMs: 120_000 }`.
  Operators who hate the modal can disable it; heuristic still runs.

### Track D — Frontdesk learning loop (P5-3)

#### D1 — `repo.listRecentAcceptedDecisions({ sinceEpoch, limit })`
- [ ] Returns the most recent N rows from `frontdesk_decision`
  joined with `history_session.outcome` where outcome ∈
  `{accepted, partial}` (rejected is anti-signal — exclude). Limited
  by `sinceEpoch` (typically `now - 7 * 24 * 3600`).
- [ ] Each row exposes `{ taskHash, llmInput: { task, candidates },
  llmOutput: { persona, provider, reasoning } }`.
- [ ] **Test (integration):** seed the table, assert the join +
  filter.

#### D2 — `buildFewShotBlock(decisions)`
- [ ] Pure helper. Returns a markdown block:
  ```
  # Recent picks the operator accepted (last 7 days)

  Task: <truncated 120 chars>
  Pick: persona=<label>, provider=<id>
  Why: <reasoning, truncated 200 chars>
  ---
  ...
  ```
- [ ] Truncation aggressive — the few-shot block has to stay under
  a 1k-token soft cap to not blow the cached prefix budget.
- [ ] **Test (unit):** snapshot the rendered output for a fixture set;
  assert truncation rules and the `# Recent picks` header.

#### D3 — Wire into `buildPrompt`
- [ ] In `src/frontdesk/prompt.js`: between persona catalog and skill
  catalog blocks, insert the few-shot block when
  `state.recentAcceptedDecisions?.length >= settings.frontdesk.llm.fewShot.minSampleSize`
  (default 3).
- [ ] Block carries `cache_control: { type: 'ephemeral' }` like its
  siblings.
- [ ] **Test (unit):** extend `test/frontdesk/llm-prompt.test.js` —
  assert block presence with sample data, absence with 0 / 2 decisions.

#### D4 — Runner injection
- [ ] `src/frontdesk/runner.js`: when `repo.listRecentAcceptedDecisions`
  exists and `settings.frontdesk.llm.fewShot.enabled !== false`,
  read decisions in the configured window and stuff onto state for
  the prompt builder.

#### D5 — Settings
- [ ] `settings.frontdesk.llm.fewShot.{ enabled: true, windowHours: 168,
  count: 5, minSampleSize: 3 }`.

---

## Acceptance (P5 exit checklist for this scope)

- [ ] `GET /api/_health` returns 200 with the documented JSON when the
  app is healthy; 503 when the DB is unreachable (A1).
- [ ] `GET /api/_metrics` returns the documented JSON shape (A2).
- [ ] All log call sites route through pino with secret redaction
  (A3); no leaked secrets in logs across the bench run.
- [ ] `node bench/frontdesk-acceptance/run.mjs` runs end-to-end on
  this machine, produces a report, and the aggregate is ≥ 18/20 (B).
  When green, `frontdesk.llm.enabled = true` is flipped in defaults
  (B5).
- [ ] Operator can mark a session's outcome from the dashboard;
  the heuristic skips when an operator value is set; the 120s grace
  window applies (C).
- [ ] When ≥3 accepted decisions exist in the last 7 days, the
  frontdesk prompt carries a few-shot block in the cached system
  prefix (D). Decision output remains stable.

---

## Risks / open questions

- **20-task fixture authorial bias.** I (or whoever writes B1) will
  encode my mental model of "right pick per task" — that's not the
  same as a held-out user benchmark. Mitigation: keep the fixture
  set in a single JSON, easy to extend; treat 18/20 as a *floor*
  to ship the default flip, not a ceiling on quality. Plan to grow
  the fixture set to 50+ tasks in a P5 wave 2.
- **Few-shot block bleeding into cache eviction.** Pinning new
  content into the cache_control: ephemeral block changes the cache
  key with every decision write. Mitigation: hash the block content
  daily, not per-request — generate the few-shot once per day and
  cache the rendered text in `app.locals.fewShotBlockToday`. Spec'd
  in D2 implicitly via the truncation; make the daily-stable
  generation explicit in the runner.
- **Operator outcome modal annoyance.** A modal that fires on every
  session-end becomes noise fast. The 120s grace + per-session
  one-shot + a "don't ask me again this hour" toggle would help.
  Out of scope here; treat the v1 as the minimal version; iterate
  on signal.
- **Logger swap regressions.** Replacing console.log with pino at
  ~100 call sites is a big diff. Mitigation: ship A3 first as a
  thin shim that proxies through pino while keeping the existing
  `log.info(msg, meta)` arity. Audit call sites in a follow-up if
  pino's structured-args ergonomics demand it.
- **Benchmark requires running the LLM.** The default transport is
  LMStudio + Gemma 4 E4B. The benchmark won't run on a machine
  where LMStudio isn't reachable. Document the precondition; the
  CLI subcommand prints a clear "start LMStudio first" error rather
  than failing inside `run.mjs`.

## How we verify

- A1, A2, B-shape tests, C1, D2 covered by automated tests.
- A3, A4 covered by manual smoke + the redaction unit tests carried
  over from P4-A2.
- B is its own verification — running the benchmark *is* the test.
- C3 (UI modal) is manual smoke; UI test scaffolding still doesn't
  exist.
- D3 round-trip is covered by extending `llm-prompt.test.js` and
  reading the prompt body for the marker.

## What this is not

- Not the gh-bridge / project-activity ticker (P5-1, deferred).
- Not the persona-evolution offline job (P5-4, depends on a much
  larger `frontdesk_decision` corpus).
- Not the read-only session share (P5-6, distinct feature).
- Not sprite animations on `/legacy` (P5-7, polish).
