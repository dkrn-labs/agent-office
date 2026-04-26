# Frontdesk LLM — Phase 2 (P2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`
> to walk this plan task-by-task. Steps use `- [ ]` checkboxes for tracking.
>
> **Test discipline:** during the TDD inner loop run `npm run test:unit`
> (sub-second). Only run `npm run test:integration` at task-exit and at the
> phase-exit checklist — that's where DB-backed and Fastify-graph tests
> live.

**Goal.** Add a Haiku 4.5 LLM stage 2 to the frontdesk router. Rules
remain stage 1 and stay authoritative for hard constraints; the LLM
re-orders / picks within the candidates rules produced, validated by Zod,
and falls back to "first candidate of each type" when the schema fails.
Every decision gets logged to a new `frontdesk_decision` table for the
learning loop. Implements the remaining rules 9–12 and 15–16 from
architecture §6.1.

**Trigger.** P1 is shipped. Settings flag `frontdesk.llm.enabled` is the
only gate; default stays `false` until acceptance is met (see exit
checklist).

**Architecture references.**
- `docs/architecture/agent-commander.md` §6.1, §6.2, §6.3
- `docs/architecture/implementation-plan.md` §P2
- `docs/architecture/benchmark-plan.md` (D-band: `llm`)

**Tech stack.** Node 22 ESM · `better-sqlite3` · `node:test` · Zod 4 ·
`@anthropic-ai/sdk` (new dep). Prompt caching via the SDK's
`cache_control: { type: 'ephemeral' }` blocks.

**Out of scope.**
- Local-provider routing for the LLM stage (P3 swaps in `frontdesk.llm.provider`).
- Persona-evolution mining job (P5-4).
- 5-shot fewshot block beyond a static placeholder (P5-3 — "learning loop").
- UI redesign — only the existing reasoning string slot is populated.

---

## File Structure

**Create:**
- `src/db/migrations/008-frontdesk-decision.js` — `frontdesk_decision` table.
- `src/frontdesk/llm.js` — Anthropic SDK call, prompt assembly, Zod
  output schema, fallback.
- `src/frontdesk/decision-log.js` — thin writer over `repo` for the new
  table (so `runner.js` stays I/O-free).
- `src/frontdesk/prompt.js` — pure builder for the cached/uncached prompt
  blocks (testable without an Anthropic key).
- `test/frontdesk/llm-prompt.test.js` (unit)
- `test/frontdesk/llm-fallback.test.js` (unit, mocks the SDK)
- `test/frontdesk/decision-log.test.js` (unit, temp DB)
- `test/db/migration-008-frontdesk-decision.test.js` (unit, temp DB)
- `test/frontdesk/rules-extended.test.js` (unit, R9–R12, R15, R16)
- `test/api/frontdesk-route-llm.test.js` (integration)

**Modify:**
- `src/frontdesk/rules.js` — add R9, R10, R11, R12, R15, R16.
- `src/frontdesk/runner.js` — call stage 2 when settings flag is on; pass
  `decisionLog` writer.
- `src/api/routes/frontdesk.js` — pass through `runLLM`-aware deps; surface
  `meta.stage = 'rules+llm'` when LLM ran, `'rules-only'` otherwise.
- `src/api/server.js` — wire `frontdesk.llm.enabled` from settings, pass
  Anthropic client + repo writer.
- `src/db/repository.js` — add `recordFrontdeskDecision`,
  `listFrontdeskDecisions(limit)`.
- `src/core/settings.js` — extend defaults with
  `frontdesk.llm.model = 'claude-haiku-4-5'`.
- `package.json` — add `@anthropic-ai/sdk` dependency.

---

## Task 1 — Settings + Anthropic client wiring (no LLM call yet)

The smallest possible vertical slice: settings exposes a `model` knob and
the SDK is installed and constructable. Doesn't make any network calls.

**Files:**
- Modify: `src/core/settings.js`
- Modify: `package.json` (dep)

- [ ] **Step 1 — Failing test.** `test/core/settings.test.js` (extend
      existing if present, otherwise add): assert that
      `getDefaultSettings().frontdesk.llm` carries `enabled: false` and
      `model: 'claude-haiku-4-5'` (the latest Haiku 4.5 model id).
- [ ] **Step 2 — Run.** `npm run test:unit -- --test-name-pattern="frontdesk"`. Confirm fail.
- [ ] **Step 3 — Implement.** Add `model: 'claude-haiku-4-5'` to the
      default object in `getDefaultSettings`. Keep `enabled: false`.
- [ ] **Step 4 — Add dep.** `npm install @anthropic-ai/sdk@latest`. Verify
      `package-lock.json` updated.
- [ ] **Step 5 — Run.** `npm run test:unit`. All green.
- [ ] **Step 6 — Commit.**
      ```
      feat(settings): expose frontdesk.llm.model and add anthropic sdk
      ```

---

## Task 2 — `frontdesk_decision` table (migration 008)

**Files:**
- Create: `src/db/migrations/008-frontdesk-decision.js`
- Create: `test/db/migration-008-frontdesk-decision.test.js`

- [ ] **Step 1 — Failing test.** Open a temp DB, run migrations, assert
      `frontdesk_decision` table exists and accepts an insert with the
      shape from architecture §6.3:

      ```sql
      id INTEGER PRIMARY KEY,
      task_hash TEXT NOT NULL,
      rules_applied TEXT,        -- JSON
      llm_input TEXT,            -- JSON
      llm_output TEXT,           -- JSON
      user_accepted TEXT,        -- JSON, nullable
      outcome TEXT,              -- 'accepted'|'partial'|'rejected'|null
      created_at_epoch INTEGER NOT NULL
      ```

      Index on `created_at_epoch DESC` for the few-shot sampler.
- [ ] **Step 2 — Run.** `npm run test:unit`. Confirm fail.
- [ ] **Step 3 — Implement.** Mirror the structure of
      `007-launch-budget.js`: `export const version = 8`; `export function up(db)`.
- [ ] **Step 4 — Run.** `npm run test:unit`. All green.
- [ ] **Step 5 — Commit.**
      ```
      feat(db): migration 008 — frontdesk_decision table
      ```

---

## Task 3 — Repository writers

**Files:**
- Modify: `src/db/repository.js`
- Create: `src/frontdesk/decision-log.js` (thin wrapper around the repo,
  hashes the task, stringifies JSON columns).
- Create: `test/frontdesk/decision-log.test.js`

- [ ] **Step 1 — Failing test.** Round-trip: write a decision via the
      log, read it back via `repo.listFrontdeskDecisions({ limit: 5 })`,
      assert all JSON columns parse correctly and `task_hash` is stable.
- [ ] **Step 2 — Run.** `npm run test:unit`. Confirm fail.
- [ ] **Step 3 — Implement** `recordFrontdeskDecision({ taskHash,
      rulesApplied, llmInput, llmOutput, userAccepted = null,
      outcome = null })` and `listFrontdeskDecisions({ limit, outcome })`
      in `repository.js`. Decision-log module hashes the task with
      `crypto.createHash('sha256')`.
- [ ] **Step 4 — Run.** `npm run test:unit`. All green.
- [ ] **Step 5 — Commit.**
      ```
      feat(repo): record/list frontdesk_decision rows
      ```

---

## Task 4 — Pure prompt builder

**Files:**
- Create: `src/frontdesk/prompt.js`
- Create: `test/frontdesk/llm-prompt.test.js`

The builder takes `(state, task, candidates)` and returns
`{ system, messages }` shaped for the Anthropic SDK, with cache-control
breakpoints on persona catalog, skill catalog, and rule-chain summary.
**No SDK import here — pure data in, pure data out.** This is what makes
the prompt unit-testable.

- [ ] **Step 1 — Failing test.** Snapshot the shape: system block exists,
      persona-catalog block has `cache_control: { type: 'ephemeral' }`,
      dynamic suffix contains the literal task text and the rule trace.
      Assert no PII (process env, API keys) leaks into the prompt body.
- [ ] **Step 2 — Run.** `npm run test:unit`. Confirm fail.
- [ ] **Step 3 — Implement.** Pure functions: `buildSystem`,
      `buildPersonaCatalogBlock`, `buildSkillCatalogBlock`,
      `buildRuleChainSummary`, `buildDynamicSuffix`, `buildPrompt`.
- [ ] **Step 4 — Run.** `npm run test:unit`. All green.
- [ ] **Step 5 — Commit.**
      ```
      feat(frontdesk): pure prompt builder with cache-control blocks
      ```

---

## Task 5 — LLM caller + Zod output schema + fallback

**Files:**
- Create: `src/frontdesk/llm.js`
- Create: `test/frontdesk/llm-fallback.test.js`

LLM call is dependency-injected (`{ client }`) so the test substitutes a
fake. Output is validated with the Zod schema from arch §6.2. On schema
fail, `runLLM` returns the rules-only "first candidate of each type"
proposal **without** throwing — the launch must never block on a router
hiccup.

- [ ] **Step 1 — Failing test (3 cases).**
      1. Happy path: fake client returns valid JSON, `runLLM` returns it.
      2. Schema fail: fake client returns malformed JSON, `runLLM`
         returns the rules-only fallback shape and tags `meta.fallback = 'schema'`.
      3. Network/SDK error: fake client throws, `runLLM` returns the
         rules-only fallback and tags `meta.fallback = 'error'`.
- [ ] **Step 2 — Run.** `npm run test:unit`. Confirm fail.
- [ ] **Step 3 — Implement** `runLLM({ client, model, prompt, candidates })`
      using `client.messages.create(...)` with the cached prompt. Zod
      schema lives in this file. Always returns `{ proposal, meta }` —
      never throws.
- [ ] **Step 4 — Run.** `npm run test:unit`. All green.
- [ ] **Step 5 — Commit.**
      ```
      feat(frontdesk): Haiku reasoner with Zod schema + safe fallback
      ```

---

## Task 6 — Remaining rules R9, R10, R11, R12, R15, R16

These are the rules that don't strictly require an LLM but are most
useful when read alongside it (verb biasing, length heuristic, etc.).
They land **before** the LLM stage so the LLM gets a tighter candidate
set.

**Files:**
- Modify: `src/frontdesk/rules.js`
- Create: `test/frontdesk/rules-extended.test.js`

- [ ] **Step 1 — Failing tests** — one per rule, asserting only that
      rule's effect on a synthetic state:
      - R9: verbs `debug|fix|crash|error` → bias `debug` persona.
      - R10: short task (≤60 chars) + mechanical verbs (`rename|format|add comment`) → tag `oneshot`, prefer cheap/local provider.
      - R11: contains `across the codebase` / `refactor X to Y` / >500-char task → tag `long-running`, prefer Opus/Sonnet.
      - R12: cross-project switch from current cache-warm project → soft penalty.
      - R15: history candidate `score < 0.4` (input passed in) → drop.
      - R16: pre-fill total > 12k tokens → trim lowest-score history until under cap.
- [ ] **Step 2 — Run.** `npm run test:unit`. Confirm fail (`R9..R16 not defined`).
- [ ] **Step 3 — Implement.** Add each rule as a pure function. Append to
      the `RULES` array in correct order (after R8, before R13).
- [ ] **Step 4 — Run.** Full unit suite. Existing rule tests must stay green.
- [ ] **Step 5 — Commit.**
      ```
      feat(frontdesk): rules R9–R12 and R15–R16
      ```

---

## Task 7 — Wire stage 2 into the runner

**Files:**
- Modify: `src/frontdesk/runner.js`
- Create: `test/frontdesk/runner-llm-stage.test.js` (unit; injects fake LLM)

The runner gains a second stage gated on `prefs.frontdesk?.llm?.enabled`.
When off → unchanged behavior. When on → calls `runLLM`, persists the
decision via the injected `decisionLog`, and returns the proposal with
`meta.stage = 'rules+llm'`.

- [ ] **Step 1 — Failing test.**
      - With `enabled: false`, runner returns the same shape as today and
        does not touch the injected LLM/log.
      - With `enabled: true`, runner calls `runLLM`, then `decisionLog.record`,
        and returns proposal + `meta.stage`.
- [ ] **Step 2 — Run.** `npm run test:unit`. Confirm fail.
- [ ] **Step 3 — Implement.** Inject `runLLM` + `decisionLog` via the
      `route()` deps. Keep `route()` async-clean.
- [ ] **Step 4 — Run.** `npm run test:unit`. All green. Existing
      `frontdesk-route` API test still green via `npm run test:integration`.
- [ ] **Step 5 — Commit.**
      ```
      feat(frontdesk): runner stage-2 wiring with decision logging
      ```

---

## Task 8 — Server wiring + route meta

**Files:**
- Modify: `src/api/server.js`
- Modify: `src/api/routes/frontdesk.js`
- Create: `test/api/frontdesk-route-llm.test.js` (integration)

- [ ] **Step 1 — Failing test (integration).** Boot `createApp` with a
      stub LLM client (injected via deps). POST a task. Assert response
      `meta.stage === 'rules+llm'` and `data.reasoning` is non-empty.
      Second case: settings flag off → `meta.stage === 'rules-only'`.
- [ ] **Step 2 — Run.** `npm run test:integration -- --test-name-pattern="frontdesk-route-llm"`. Confirm fail.
- [ ] **Step 3 — Implement.** In `server.js`, lazily construct an
      `Anthropic` client when `settings.frontdesk.llm.enabled` is true and
      `ANTHROPIC_API_KEY` is set. Pass `runLLM`-bound deps to
      `frontdeskRoutes`. Surface `meta.stage` in route responses.
- [ ] **Step 4 — Run.** `npm run test:integration`. All green (modulo the
      pre-existing `portfolio-stats` failure tracked in
      `docs/issues/0001-portfolio-stats-fixture-stale-dates.md`).
- [ ] **Step 5 — Commit.**
      ```
      feat(api): mount frontdesk LLM stage when settings enable it
      ```

---

## Task 9 — Phase-exit verification

- [ ] **Step 1 — Lint/typecheck/format** if a script exists; otherwise
      skip.
- [ ] **Step 2 — Run** `npm run test:unit` → all green.
- [ ] **Step 3 — Run** `npm run test:integration` → all green except
      issue #0001 (still pending fix). Confirm no new failures introduced.
- [ ] **Step 4 — Manual smoke (optional, requires an `ANTHROPIC_API_KEY`):**
      flip `frontdesk.llm.enabled = true` in `~/.agent-office/settings.json`,
      restart the server, POST a representative task, confirm
      `data.reasoning` reads as a sensible 1–2 sentence justification, and
      a row appears in `frontdesk_decision`.
- [ ] **Step 5 — Update** `docs/superpowers/plans/unified-history-roadmap.md`
      *only if it tracks P2 phase status* (it doesn't today — that file is
      scoped to unified-history). Update the P2 row in
      `docs/architecture/implementation-plan.md` if/when acceptance below
      is hit on a benchmark.

---

## Acceptance (from `implementation-plan.md` §P2 exit)

- [ ] `frontdesk_decision` table populated on every routed task.
- [ ] Reasoning string visible in the route response (and therefore in UI).
- [ ] On the curated 20-task benchmark, **rules+LLM ≥17/20** vs
      rules-only ≤14/20. (Benchmark harness lives in
      `bench/`; bench script update is **not** part of this plan and ships
      separately if missing.)
- [ ] Sub-second p95 latency per route call (warm cache).
- [ ] Cost per call ≤ $0.0002 (cache hit).

> Acceptance gates the **flip** of `frontdesk.llm.enabled` to `true` in
> defaults — not the merge of this plan. The plan ships with the flag off.

---

## Self-review notes

- The Zod fallback path is the load-bearing safety net. Tests cover it
  three ways; do not collapse them.
- Rules array order matters: R9–R12 must run **before** R13/R14 so the
  LLM stage gets the trimmed set. R15/R16 are post-history-merge — they
  can run last.
- Prompt builder is the only file that knows the persona/skill catalog
  shape; if either schema changes elsewhere, this is the file to update.
- The decision log is append-only. No update path. Outcome is patched in
  later by the same hook that classifies session outcomes (P1-6).
- We do **not** ship the few-shot sampler in this plan; the prompt
  reserves the slot but inserts a placeholder. P5-3 fills it.
