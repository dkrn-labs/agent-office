# Issue #0004 — Frontdesk LLM acceptance gate at 16/20 (below 18/20 floor)

**Status:** Open — bench gate not met; default `frontdesk.llm.enabled` stays `false`
**Opened:** 2026-04-26
**Severity:** Medium (UX, not correctness)
**Area:** `bench/frontdesk-acceptance/`, `src/frontdesk/prompt.js`,
`src/frontdesk/rules.js`, `config/provider-capabilities.default.json`

## Summary

The 20-task acceptance benchmark (P5-B) currently passes **16/20**
with the LMStudio + Gemma 4 E4B routing path (default transport).
The 18/20 gate guards the planned default flip of
`frontdesk.llm.enabled = true` in `getDefaultSettings()`. We do
**not** flip the default until the gate is met; this issue tracks
the four failing fixtures and the calibration work to close the gap.

Failures are stable across runs (Gemma at temperature 0; both
re-runs identical):

| Task | Expected | Got | Read |
|---|---|---|---|
| `mechanical-1` "rename getUserById to findUserById…" | persona=backend, provider.kind=local | persona=**review**, provider=lmstudio | LLM reads "rename" as "review for consistency" instead of "do the rename". |
| `mechanical-3` "Add a one-line JSDoc comment to each exported function in repository.js" | persona=backend, provider.kind=local | persona=**review**, provider=lmstudio | Same misread; "comment on every function" pattern-matches review. |
| `frontend-2` "drawer flickers on first paint — fix the rendering glitch in Framer Motion" | persona=frontend | persona=**debug**, provider=gemini-cli | Reasonable disagreement: "fix glitch" is debug-flavored frontend. |
| `refactor-3` "Replace every direct better-sqlite3 usage with the repository abstraction; ~30 files" | provider.kind=cloud (long-running) | provider=lmstudio (local) | Cross-codebase mechanical edits — genuine ambiguity between "30 mechanical edits → local, free" and "long-running refactor → cloud, sustained reasoning". |

## Reproduce

```bash
# Prereqs: LMStudio running with google/gemma-4-e4b loaded.
node bench/frontdesk-acceptance/run.mjs --llm --report bench/frontdesk-acceptance/report.md
```

Exits 0 when ≥18/20, 1 otherwise. The script is idempotent against a
temp DB (no global state).

## Calibration paths (each is its own follow-up)

1. **Few-shot examples for "rename" / "comment" intents** (P5-D, this
   plan). Once 3+ accepted decisions exist for those task shapes, the
   learning loop should bias the LLM away from review-persona on
   mechanical tasks. Test the bench again after the few-shot block has
   real data.
2. **Strengthen R10 (oneshot tag) to also bias persona ordering** —
   currently R10 only flags taskType=oneshot; making it also drop
   review/devops personas from the candidate set when the verbs are
   pure mechanical (rename/comment/format/bump-version) would force
   the LLM to pick from `[backend, frontend]` not `[review, ...]`.
3. **Vendor-selection criteria explicit cap on local for "many files"**
   — the prompt should clarify that "30 files" puts a task into the
   long-running cloud lane regardless of the per-edit complexity.
   `src/frontdesk/prompt.js` SYSTEM_TEXT vendor-selection bullet.
4. **Grow the fixture set** to 50+ tasks (P5 wave 2). 20 is too small
   to be statistically meaningful — one ambiguous task is 5%.

## Context

The previous bench iteration in `docs/experiments/2026-04-26-frontdesk-llm-local.md`
already noted the rename/review confusion and called it out as a
"few-shot quality miss across every model tested". That was P2-13
re-bench against 5 tasks; this is the production 20-task gate. Same
issue, just measured.

## What's *not* the problem

- Schema validation: 20/20 tasks return Zod-valid proposals. The LLM
  reliably emits the right shape; the picks themselves are the gap.
- Latency: ~6s per task on LMStudio + Gemma 4. Acceptable.
- Provider availability: aider-local routes correctly when
  `mustBeLocal=true` rules fire (privacy-1, privacy-2, secret-1,
  secret-2 all pass).

## Decision

**Keep `frontdesk.llm.enabled = false` in defaults until ≥18/20.**
Operators who opt in via `settings.json` get the 16/20 routing today;
the rest get rules-only (deterministic, no surprise misroutes) until
the calibration in #1–#3 above lands.

Re-run the bench after each calibration change. Close this issue when
the gate clears.
