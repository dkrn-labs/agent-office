# Benchmark Plan — A/B/C/D Context Strategies × 4 Task Types

**Status:** design ready, fixtures pending
**Companion:** [`agent-commander.md`](./agent-commander.md), [`implementation-plan.md`](./implementation-plan.md)
**Last updated:** 2026-04-25

This is a tracked benchmark, not a one-off. The goal is to **prove or
disprove** that agent-office's context filtering actually saves time
and tokens, broken down by which classifier we use and which task
type the operator is doing.

The bench harness shape is similar to the existing
`bench/whitepaper/` runs (brief vs raw-memory). This plan extends
that to a 4×4 matrix.

---

## 1 · Hypotheses

We test four hypotheses simultaneously:

| H | Statement |
|---|---|
| **H1** | Raw memory dump (B) is faster than no-context (A) on history-relevant tasks. |
| **H2** | Heuristic-filtered context (C) is at least as good as raw dump (B) at lower token cost. |
| **H3** | LLM-classified context (D) is meaningfully better than heuristic (C) on tasks where reasoning about *type* matters (`decision`, `discovery`). |
| **H4** | The optimal condition varies by task type — i.e. there is no single "best" condition; routing matters. |

If H4 holds, the right product behavior is to *pick a condition based
on the task* — which is exactly what the frontdesk router is for.

---

## 2 · Conditions (the four cells of A/B/C/D)

| Cell | Name | What gets loaded into the agent's context |
|---|---|---|
| **A** | `no-context` | Bare task prompt only. No system prompt. No skills. No history. (Baseline; floor for usefulness.) |
| **B** | `raw-dump` | Full system prompt + all installed skills + last 50 observations (unfiltered) + full project memory. (Ceiling for "kitchen sink" approaches.) |
| **C** | `heuristic` | Persona-filtered observations using the P0 heuristic classifier (rule-based bugfix / feature / refactor / decision / discovery / security_*). Skills filtered to persona defaults. |
| **D** | `llm` | Same shape as C, but the classifier is a Haiku 4.5 LLM call (P2). Same selection budget. |

The same task prompt and persona is used across all four cells of a
single task type. Only the context payload differs.

---

## 3 · Task types (four distinct work shapes)

Four canonical tasks, each tied to a fixture project. Tasks chosen to
exercise different *kinds* of memory dependency.

### T1 · `update-frontend`

**Project:** `bench_frontend` (React + Vite + Tailwind + Framer Motion).
A modest 8–12 component app with a working build.

**Task prompt:**
> Add a "Recently Viewed" panel to the homepage that shows the last 5
> items the user clicked, persisted to localStorage. Match the existing
> design system (use the same card style and spacing as the
> `<FeaturedItems>` panel already on the page).

**Why this task:** depends on **knowing existing patterns**. History
relevance is high (matching design system, persisting state). Tests
whether classifier surfaces the right `feature` and `change`
observations.

### T2 · `update-backend`

**Project:** `bench_backend` (Fastify + Drizzle + PostgreSQL or SQLite).
~6 routes, ~3 schemas.

**Task prompt:**
> Add an endpoint `POST /api/notes/:id/share` that creates a share
> token (16-char base32), persists it with a 7-day TTL, and returns
> a shareable URL. Add the corresponding migration. Follow the same
> error-handling style as the existing `POST /api/notes`.

**Why this task:** depends on **prior decisions** (auth pattern, error
shape, migration style). Tests whether classifier surfaces relevant
`decision` and `feature` observations.

### T3 · `debug-issue`

**Project:** `bench_debug` (Node + Express + a deliberately broken
WebSocket reconnection logic).

**Task prompt:**
> Users report that after the WebSocket disconnects on a flaky
> network, the client sometimes receives duplicate messages on
> reconnect. Reproduce, find the root cause, fix it, and add a test.

**Why this task:** depends on **prior bugfix history** (similar past
reconnection issues, related test patterns). Tests whether classifier
surfaces the right `bugfix` and `discovery` observations. Highest
expected gain for C and D over A.

### T4 · `do-planning`

**Project:** `bench_planning` (an existing app considering a major
direction change — e.g. monolith → split, or v1 → v2 schema migration).

**Task prompt:**
> We're considering moving the notification system from in-process
> queue to Redis Streams. Write a 1-page plan: what changes, what
> stays, risks, rollback path, and the sequence of PRs.

**Why this task:** **no code change required**. Output is a doc.
Depends heavily on prior `decision` observations and architectural
context. Tests the upper end of LLM classifier value (decisions are
the hardest type for heuristics).

---

## 4 · Fixture preparation (the upfront work)

Each of the 4 projects must be:

1. **A real, buildable repo** — checked into a `bench/fixtures/`
   directory or scriptable via `bench/seed-fixtures.sh`.
2. **Pre-loaded with history** — each project's
   `history_observation` rows seeded with ≥30 observations spanning
   the relevant types. Mix of relevant and irrelevant so the
   classifier has to work.
3. **Stable under git** — same starting commit hash for every run, so
   B/C/D operate on identical project state.
4. **Reproducible reset** — `bench/reset-fixture.sh <name>` restores
   the project + DB to clean state between runs.

### Per-project history seed plan

| Project | Total obs | bugfix | feature | refactor | decision | discovery | security |
|---|---|---|---|---|---|---|---|
| bench_frontend | 32 | 4 | 12 | 6 | 4 | 4 | 2 |
| bench_backend | 36 | 6 | 10 | 6 | 8 | 4 | 2 |
| bench_debug | 40 | 16 | 6 | 4 | 4 | 8 | 2 |
| bench_planning | 36 | 4 | 6 | 4 | 16 | 4 | 2 |

Mix is intentionally biased toward each project's task type so that
classifier quality has signal to work with.

Seed observation content: a realistic title + 1-paragraph narrative +
2-3 filesModified entries each. Generated by an LLM pass against
synthetic but plausible commits.

---

## 5 · Metrics captured per run

For each of the 16 cells (4 tasks × 4 conditions), capture:

| Metric | Source | Why |
|---|---|---|
| `wall_ms` | harness timer | end-user time-to-done |
| `input_tokens` | provider response | direct token cost (input) |
| `output_tokens` | provider response | direct token cost (output) |
| `cache_read_tokens` | provider response | cache hit rate signal |
| `cache_write_tokens` | provider response | cache fill cost |
| `total_cost_usd` | provider response | dollars |
| `num_turns` | provider response | "did it loop?" |
| `tool_calls` | provider response | activity proxy |
| `loaded_context_tokens` | harness (before launch) | how much we paid to *enable* this run |
| `success` | judge prompt → 0/1 | did it actually do the task? |
| `quality_score` | judge prompt → 1-10 | how well? |
| `judge_rationale` | judge prompt | qualitative note |

**Judge:** Claude Sonnet 4.6 with a fixed evaluation prompt per task
type. Judge sees: original task, agent's final output (or diff), and
a task-specific rubric. Judge does *not* know which condition produced
the output (blinded by file rename before evaluation).

---

## 6 · Run protocol

For each cell, run **N = 3 repetitions** to average out variance.
Total runs: **4 × 4 × 3 = 48**.

Per run:

1. `bench/reset-fixture.sh <project>` — restore project + DB to clean
   state.
2. `bench/load-context.sh <condition> <project> <persona>` — prepare
   the context payload per condition spec.
3. `bench/run-cell.sh <task> <condition> <repeat>` — launch agent in
   non-interactive mode (claude `--print`, codex non-tty, etc.) with
   the prepared context. Capture all metrics. Time-out at 10 min per
   run (any timeout = `success=0`).
4. `bench/judge.sh <task> <run_id>` — invoke Sonnet judge against the
   run's output. Append result to `bench/results/<task>__<condition>__<repeat>.json`.

Order randomized to control for time-of-day cache state effects.

### Provider choice for the bench

Run the matrix on **claude-code** with **sonnet-4.6** as the agent
model. Single provider keeps comparisons clean. (A future P3 follow-up
can re-run on codex / gemini / ollama-aider once those providers are
through the adapter contract.)

---

## 7 · Report format

`bench/results/AGGREGATE.md` — auto-generated after all 48 runs:

### Headline numbers

```
                     time_p50    tokens_in_p50   $cost_p50   success_rate    quality_p50
T1 update-frontend
  A no-context           ?              ?            ?            ?              ?
  B raw-dump             ?              ?            ?            ?              ?
  C heuristic            ?              ?            ?            ?              ?
  D llm                  ?              ?            ?            ?              ?
T2 update-backend
  ...
T3 debug-issue
  ...
T4 do-planning
  ...
```

Plus per-task delta tables (B vs A, C vs B, D vs C) showing % savings
or % gains.

### Verdicts

For each hypothesis (H1–H4): **supported / not supported / inconclusive**,
with the underlying numbers.

### Recommendations

Translate the verdicts into product decisions. Examples (will be
filled in after running):

- *"On debug-issue, condition C is 47% faster than B with no quality
  loss → ship heuristic by default for debug persona."*
- *"On do-planning, condition D is 22% better quality than C and
  30% better than B, at 3× C's classifier cost — ship LLM
  classifier only for review/architect personas."*

---

## 8 · Cost estimate (so we know what we're committing to)

Rough per-run cost on Sonnet 4.6:

- A no-context: ~2k input + 2k output ≈ **$0.04**
- B raw-dump: ~25k input (cache miss first time) + 5k output ≈ **$0.30**
- C heuristic: ~10k input + 4k output ≈ **$0.13**
- D llm: ~10k input + 4k output + Haiku classifier (~300 tokens) ≈ **$0.13**

48 runs × ~$0.15 average ≈ **$7.20** for the full sweep. Run by judge:
48 × ~$0.02 ≈ **$1.00**. Total **<$10**, ~3 hours wall time
unattended.

If we widen to 3 providers later, multiply by 3.

---

## 9 · Acceptance criteria for the benchmark itself

The benchmark is **delivered** when:

- [ ] All 4 fixture projects exist under `bench/fixtures/`, scriptable
- [ ] All 4 fixtures have correctly-distributed seeded history
- [ ] Reset script restores known state
- [ ] Harness runs all 48 cells unattended in <5h
- [ ] Judge produces consistent scores (rerun a cell 3× → judge
      stddev <1.5 on the 1-10 scale)
- [ ] AGGREGATE.md reports H1–H4 verdicts with numbers
- [ ] Recommendations section maps verdicts to product changes

---

## 10 · Where this fits in the phase plan

This benchmark is **gated by P0 + P1 completion** for condition C, and
by P2 completion for condition D. So:

- After **P1** ships: run A/B/C only (3 conditions, 12 cells, 36 runs).
  Get H1, H2 answered. ~$5.
- After **P2** ships: rerun with D added (16 cells, 48 runs). Get
  H3, H4 answered. ~$10.

If A/B/C results in P1 already show heuristic ≈ raw-dump quality at
much lower cost, that's strong evidence **before** spending P2 effort
on the LLM classifier. The benchmark can *redirect* the roadmap, not
just validate it.

---

## 11 · Open questions (resolve before kickoff)

1. **Should each fixture's seeded history be the same across runs, or
   randomized per run?** Recommendation: **same** — so we measure
   classifier behavior, not seed variance. Run-to-run variance gets
   averaged out by N=3 repetitions.
2. **Should the judge see the full transcript or only the final output?**
   Recommendation: **only final output** — keeps the judge focused on
   user-visible quality, not process.
3. **Do we publish the bench results?** It's a strong public signal
   if numbers are good, but burns reputation if numbers don't move.
   Recommendation: **internal first**, decide on publication after
   seeing results.
