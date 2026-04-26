# Multi-provider through the contract — Phase 3 (P3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`
> to walk this plan task-by-task. Steps use `- [ ]` checkboxes for tracking.
>
> **Test discipline:** during the TDD inner loop run `npm run test:unit`
> (sub-second). Only run `npm run test:integration` at task-exit and at
> the phase-exit checklist — that's where the watcher graphs and
> Fastify-graph tests live.

**Goal.** Bring codex and gemini up to the same adapter-contract surface
that claude-code already exposes (`installHook`, `parseTranscript`,
`telemetry.sample`, `quota`, savings cost shape), and land the first
**local** provider so cost-shaping rules R3/R4 actually pick something
runnable instead of just refusing to spawn. Once a local adapter exists,
the savings pill can credit local routing — the architecture's
local-vs-cloud savings story finally has a denominator.

**Trigger.** P2 (frontdesk LLM stage 2) is shipped behind
`frontdesk.llm.enabled`. The router can already pick local vs. cloud at
the prompt layer (vendor-selection block), but rule R3 (privacy=strict)
and R4 (daily cap) currently dead-end on "no local model loaded" because
no local **launch-able** provider is registered. P3 fixes that, in
contract-shape.

**Pivot from architecture spec — 2026-04-26.** Architecture
`implementation-plan.md` §P3 names `ollama-bridge` + `ollama-aider` as
the local stack. The P2 experiment
(`docs/experiments/2026-04-26-frontdesk-llm-local.md`) showed Ollama is
**~6× slower** than LMStudio for Gemma 4 on this hardware, and we've
deleted the local Ollama models. P3 substitutes:

- `ollama-bridge` → **`lmstudio-bridge`** (already partially shipped in
  P2 as the frontdesk router transport — Task 1 below promotes it to a
  shared module).
- `ollama-aider` → **`aider-local`**: an Aider adapter pointed at
  LMStudio's OpenAI-compatible endpoint. Aider supports any
  OpenAI-compatible base URL natively — no Ollama coupling.

The Ollama path is **not removed**, just demoted to opt-in. If a future
Ollama release closes the perf gap, `ollama-bridge` slots in as a peer
of `lmstudio-bridge` behind the same interface.

**Architecture references.**
- `docs/architecture/agent-commander.md` §3 (provider contract), §9.2
  (savings breakdown), §6.1 (rules R3/R4).
- `docs/architecture/implementation-plan.md` §P3 + P3 exit checklist.
- `docs/experiments/2026-04-26-frontdesk-llm-local.md` (LMStudio default).
- `docs/superpowers/plans/2026-04-26-frontdesk-llm-phase-2.md` (P2 —
  prerequisite; capability-registry shape, transport-lmstudio.js).

**Tech stack.** Node 22 ESM · `better-sqlite3` · `node:test` · existing
`src/providers/*` adapters · LMStudio's OpenAI-compatible HTTP API ·
Aider CLI (`pip install aider-chat`).

**Out of scope.**
- abtop `--rpc` and per-call timeline (P4).
- Real-time live-cost streaming for local sessions (P4 — abtop
  bridges sample data; until then, local sessions report `cost.dollars=0`
  from `telemetry.sample` with a stubbed token count derived from
  Aider's transcript).
- Multi-local-model routing (one local model per machine for now —
  whichever LMStudio has loaded at spawn time).
- Persona-evolution offline mining (P5-4).

---

## File Structure

**Create:**
- `src/providers/lmstudio-bridge.js` — shared low-level client (model
  catalog via `GET /v1/models`, single-shot completion, health probe).
  Extracted from `src/frontdesk/transport-lmstudio.js`; the frontdesk
  transport will import from here.
- `src/providers/aider-local.js` — `ProviderAdapter` for Aider pointed
  at LMStudio. `kind: 'local'`, `cost.dollars: 0`,
  `cost.cloudEquivalent` filled vs. claude-sonnet pricing.
- `src/telemetry/aider-watcher.js` — tail Aider's `.aider.chat.history.md`
  / `.aider.input.history` (or `--llm-history-file` if we set it) and
  emit `session:update`/`session:idle`/`session:expired` like the
  jsonl/codex/gemini watchers.
- `config/aider-system-prompt.md` — system-prompt template Aider
  consumes on spawn (so personas drive Aider too).
- `test/providers/codex-adapter-contract.test.js` (unit, mocks fs +
  child_process) — pins `installHook`, `parseTranscript`, `telemetry.sample`
  shapes for codex.
- `test/providers/gemini-cli-adapter-contract.test.js` (unit) — same
  for gemini.
- `test/providers/aider-local.test.js` (unit, mocks LMStudio HTTP +
  spawn).
- `test/providers/lmstudio-bridge.test.js` (unit, mocks fetch).
- `test/telemetry/aider-watcher.test.js` (integration — temp dir, real
  fs.watch).
- `test/api/savings-breakdown.test.js` (integration) — pins the
  per-provider breakdown the savings pill hover consumes.
- `test/integration/p3-matrix.test.js` (integration) — the P0 15-cell
  matrix re-run via the adapter-routed launcher (one test per cell;
  shared fixture builder).

**Modify:**
- `src/providers/codex.js` — add `installHook`, `parseTranscript`,
  `telemetry.sample`, `quota` (delegating to existing helpers — this is
  a *contract* migration, not a behavior change).
- `src/providers/gemini-cli.js` — same migration. **Move** the AfterAgent
  hook installation that today lives in P0 manual-install into
  `installHook()`, called once at app-start per registered provider.
- `src/providers/manifest.js` — register `aider-local` behind a
  capability check (only if LMStudio is reachable on settings host).
- `src/api/server.js` — at startup, call `await provider.installHook?.()`
  for every registered adapter. Replaces the manual codex/gemini hook
  installs. Idempotent.
- `src/frontdesk/transport-lmstudio.js` — re-export from
  `src/providers/lmstudio-bridge.js`; keep the same external surface so
  the frontdesk LLM keeps working unchanged.
- `src/frontdesk/rules.js` — R3 and R4 currently set
  `mustBeLocal: true` and rely on the candidate-trim step to drop
  cloud providers. R7 ("must be local but no local model loaded") today
  *blocks* the spawn. After P3, with `aider-local` registered, R7 only
  blocks when LMStudio is unreachable. Adjust the R7 guard to query
  `lmstudio-bridge.healthCheck()` once per call (cached 5s).
- `src/api/routes/savings.js` — add per-provider-kind breakdown
  (`{ cloud: { ... }, local: { ... } }`) on top of the existing rollup.
- `src/agents/launcher.js` — when adapter `kind === 'local'`, set
  `launch_budget.cost_dollars = 0` and
  `cloud_equivalent_dollars = baselineTokens × claude-sonnet $/1k`.
  This is the savings-credit calculation that the pill hover surfaces.
- `bin/agent-office.js` — extend `agent-office providers list` to
  include `aider-local` and its LMStudio reachability state.
- `src/core/settings.js` — add `providers.aider.{ enabled, model,
  lmstudioHost }`. Disabled by default until the user opts in.

**Delete:**
- Nothing. P0/P1 manual hook-install code paths in `src/api/server.js`
  (the explicit `codex.installHook()` / `gemini.installHook()` calls)
  collapse into the generic for-each loop introduced by Task 4 — but
  the underlying helpers stay reachable via the adapter.

---

## Tasks

### Task 1 — Extract `lmstudio-bridge` from the frontdesk transport
- [ ] Move pure HTTP/model-catalog logic out of
  `src/frontdesk/transport-lmstudio.js` into
  `src/providers/lmstudio-bridge.js`. Surface:
  `healthCheck()`, `listModels()`, `complete({ model, messages, ... })`.
- [ ] Keep `transport-lmstudio.js` as a *thin wrapper* that calls the
  bridge — frontdesk Task 10 from P2 keeps working unchanged.
- [ ] **Test (unit):** `lmstudio-bridge.test.js` mocks `fetch`; covers
  health-probe success/failure, model-catalog parse, completion success,
  HTTP error → typed `LmStudioError`.
- [ ] **Test (regression):** existing `transport-lmstudio.test.js` still
  passes against the wrapper.

### Task 2 — codex adapter migration to full contract
- [ ] Implement `codex.parseTranscript(transcriptPath)` reading codex
  `logs_2.sqlite` (per architecture §3.4 / Task #16). Return one row
  per turn matching the unified-history `provider_event` shape that the
  jsonl-watcher already produces.
- [ ] Implement `codex.installHook()` — idempotent: writes the
  AfterAgent shim to `~/.codex/hooks/post-session` only if absent or
  version-stale.
- [ ] Implement `codex.telemetry.sample(sessionId)` returning
  `{ inputTokens, outputTokens, costDollars }` from
  `repo.getLaunchBudgetForSession(sessionId)` (today the watcher writes
  this; the adapter just reads it through the contract surface).
- [ ] Implement `codex.quota()` returning `null` initially — the
  abtop-bridge real quota signal lands in P4 (issue #0002).
- [ ] **Test (unit):** `codex-adapter-contract.test.js` pins all four
  methods. `parseTranscript` uses a fixture sqlite created in
  `before()`.

### Task 3 — gemini adapter migration to full contract
- [ ] Same four methods as Task 2, against gemini's transcript layout
  (`~/.gemini/sessions/<sid>/transcript.jsonl`).
- [ ] **Test (unit):** `gemini-cli-adapter-contract.test.js`. Same
  shape — `parseTranscript`, `installHook` idempotency,
  `telemetry.sample`.

### Task 4 — Generic hook-install at app start
- [ ] In `src/api/server.js`, after manifest load, run
  `await Promise.allSettled(providers.map(p => p.installHook?.()))`.
  Log per-provider success/failure (no throw — a missing CLI shouldn't
  crash boot).
- [ ] Remove the explicit `codex.installHook` / `gemini.installHook`
  calls that exist today in P0/P1 wiring (if any). Search:
  `git grep installHook src/api`.
- [ ] **Test (integration):** `test/api/server-bootstrap.test.js` (or
  extend existing) — boot Fastify with three fake adapters, two with
  `installHook` defined; assert each is awaited exactly once and a
  rejected one logs but doesn't crash boot.

### Task 5 — `aider-local` adapter
- [ ] `src/providers/aider-local.js`:
  - `kind: 'local'`, `bin: 'aider'`,
    `defaultModel: 'openai/google/gemma-4-e4b'`
    (Aider's notation for "OpenAI-compatible endpoint, this model id").
  - `spawn(ctx)` returns a `LaunchCommand` with
    `env.OPENAI_API_BASE = settings.providers.aider.lmstudioHost + '/v1'`
    and `env.OPENAI_API_KEY = 'lm-studio'` (Aider requires a non-empty
    string but LMStudio ignores it). Args:
    `--model openai/<model>`, `--no-auto-commits`, `--yes-always`,
    `--message-file <prompt-file>` (interactive; the launcher already
    writes `$PROMPT` to a temp file).
  - `cost.dollars: 0`. `cost.cloudEquivalent` calculated at session
    end against claude-sonnet pricing (delegated to
    `src/telemetry/pricing.js`).
- [ ] Manifest registration is **conditional**: skip if
  `settings.providers.aider.enabled !== true` or if the LMStudio bridge
  health-probe fails at startup.
- [ ] **Test (unit):** `aider-local.test.js` mocks
  `lmstudio-bridge.healthCheck` and `child_process.spawn`. Covers:
  spawn args / env, model fallback, cloudEquivalent calculation,
  manifest skip-when-unhealthy.

### Task 6 — `aider-watcher` for telemetry
- [ ] Tail Aider's chat history file. Emit `session:update` on every
  user/assistant turn boundary; `session:idle` after 90s of no growth;
  `session:expired` after 10min (matches the existing jsonl-watcher
  cadence).
- [ ] Token estimation: count chars / 4 as a fallback (Aider doesn't
  emit usage). Mark `tokens.source = 'estimated'` so the savings ledger
  can flag it.
- [ ] **Test (integration):** temp dir, write history file in stages,
  assert event sequence. Ensure historySessionId threading from P2's
  Issue #0003 fix is preserved.

### Task 7 — Cost-shaping rules become enforcing
- [ ] R7 today blocks when `mustBeLocal` is set but no local provider
  exists. After Task 5, query the manifest for any registered
  `kind: 'local'` adapter. If found and healthy, R7 returns the
  candidates with `aider-local` as the only provider; if none healthy,
  R7 keeps the existing block-with-reason behavior (operator sees a
  clear "LMStudio unreachable" error in the frontdesk decision panel).
- [ ] R3 and R4 stay as-is in code — they only set the constraint;
  trim+R7 do the work.
- [ ] **Test (unit):** extend `test/frontdesk/rules-extended.test.js`
  with two new cases: privacyMode=strict + healthy local → routes to
  aider-local; privacyMode=strict + unhealthy local → R7 blocks with a
  reason that names "lmstudio unreachable".

### Task 8 — Savings pill local-vs-cloud breakdown
- [ ] `GET /api/savings?range=...` adds
  `breakdown: { cloud: { sessions, savedDollars }, local: { sessions, savedDollars } }`.
  `local.savedDollars` is the sum of `cloud_equivalent_dollars` for
  local sessions over the window (the adapter already wrote that field
  in Task 5).
- [ ] **Test (integration):** `savings-breakdown.test.js` seeds two
  cloud sessions and two local sessions in `launch_budget`, asserts the
  rollup splits correctly. Outcome=rejected rows must be excluded from
  *both* sides.
- [ ] **No UI changes in P3.** The pill hover-detail consumes the new
  field; the visual wiring is a P3 follow-up if breakdown UX still
  lives in the legacy office view, otherwise P5.

### Task 9 — Re-run the P0 15-cell matrix via the adapter path
- [ ] `test/integration/p3-matrix.test.js` parametrizes
  `(provider × spawn-mode × outcome) = 15` cells. For each: build a
  `LaunchContext` via the adapter, drive a fake transcript through the
  watcher, assert the unified-history rows, savings ledger, and
  outcome inference all populate identically across providers.
- [ ] All 15 cells must be green for the phase to exit.

### Task 10 — Settings + CLI surfacing
- [ ] `src/core/settings.js`: add `providers.aider.{ enabled: false,
  model: 'openai/google/gemma-4-e4b', lmstudioHost:
  'http://localhost:1234' }`.
- [ ] `bin/agent-office.js`: `providers list` prints aider-local with
  health (green/red dot) when enabled. `providers refresh` re-probes
  LMStudio (re-uses Task 1's `healthCheck`).
- [ ] **Test (unit):** existing `capability-registry.test.js` already
  covers the JSON shape; add a case for `aider` settings echo.

---

## Acceptance (P3 exit checklist)

From `implementation-plan.md`:

- [ ] codex + gemini through adapter contract (Tasks 2, 3) — every
  required method on `ProviderAdapter` is implemented and pinned by a
  contract test.
- [ ] aider-local works in privacy mode (Tasks 5, 7) — running the same
  task with `privacyMode = strict` routes to aider-local and produces
  unified-history rows identical in shape to a cloud run.
- [ ] Savings pill shows local-vs-cloud breakdown (Task 8) — `/api/savings`
  returns the breakdown field; an integration test pins it.
- [ ] P0 test matrix re-run via the new path (Task 9) — all 15 cells
  pass through adapter-routed launcher; no `if (provider === '…')`
  branches outside `src/providers/` (cross-cutting policy from
  implementation-plan.md).

**Functional acceptance scenario.** Run a debug task on Claude Code one
day. Flip `privacyMode = strict`. Re-run the same task — frontdesk picks
aider-local, Aider drives Gemma 4 via LMStudio, the session populates
unified history identically, the savings pill credits the local routing
under the hover breakdown.

---

## Risks / open questions

- **Aider's interactive UI in xterm.js.** Aider uses Rich / prompt-toolkit;
  same family of TUI rendering quirks claude-code has under node-pty. If
  it breaks, the fallback is `--no-pretty --no-stream` mode (degraded
  UX, but functional). Validated in Task 5 manual run, pinned in matrix.
- **Token estimation for local sessions.** Char-count/4 will misstate
  savings ±20%. Acceptable for a "credit, not invoice" pill; flag the
  estimate source so a future P4 abtop bridge can replace it.
- **Aider's auto-commit default.** Disabled via `--no-auto-commits` in
  the spawn command (Task 5). Easy to forget on future flag changes;
  the spawn-args test pins it.
- **R7 health-probe latency.** Synchronous LMStudio probe inside R7
  would add 50–500ms to every routing call. Cache for 5s (mtime-style),
  only re-probe on cache miss. The probe also runs eagerly at app start
  so the cache is warm by first router call.
