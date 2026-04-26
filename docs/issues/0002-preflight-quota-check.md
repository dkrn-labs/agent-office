# Issue #0002 — Preflight quota check before agent spawn (stub today, real check in P4)

**Status:** Closed — real signal landed via abtop-bridge in P4-A5 (2026-04-26)
**Opened:** 2026-04-26
**Closed:** 2026-04-26
**Severity:** Medium
**Area:** `src/agents/preflight-quota.js`, `src/agents/launcher.js`

## Resolution (2026-04-26)

P4-A5 wired `abtopSnapshot` into `checkQuotaBeforeSpawn`. When the
abtop-bridge is running, the preflight check reads `ctxPct` and
`status` from the most-recent matching session and rejects on
`ctxPct >= 0.99` or `status === 'rate-limited'`. Legacy
`getQuotaForProvider` path stays as the fallback when no abtop
snapshot is available. Tests under `test/agents/preflight-quota.test.js`
"P4-A — abtop snapshot path".

---

## Summary

Right before `spawnItermTab`, the launcher should ask the active provider
*"do you have headroom for this launch?"* and abort with a clear error
when the answer is no. Today the frontdesk's R5 rule already drops
providers over 95% quota from the candidate set, but that only protects
launches routed through the frontdesk. **Direct attach/relaunch paths**
(re-attach to an existing session, "launch with last persona", scripted
launches) bypass the frontdesk entirely and could spawn an agent
straight into a quota-exhausted CLI that errors on first prompt.

## What's in place today (stub)

- `src/agents/preflight-quota.js` exposes
  `checkQuotaBeforeSpawn({ providerId, repo, getQuotaForProvider, bypass })`.
- Returns `{ ok: true, source: 'stub' }` unless `getQuotaForProvider` is
  injected and returns ≥0.99, in which case `{ ok: false, reason }`.
- Wired into `launcher.launch()` between `prepareLaunch()` and
  `spawnItermTab()`. Skipped on `dryRun: true`.
- Throws an `Error` with `err.code = 'QUOTA_PREFLIGHT_FAILED'` and an
  attached `err.preflight` payload so callers can render an actionable
  message.

## What's missing (P4)

- Real per-provider 5h / 7d quota signal source. The architecture plans
  for `abtop --rpc` to expose `LiveSample` records carrying quotaPct +
  resetAt epochs (see implementation-plan.md §P4-1, P4-2).
- Wire `getQuotaForProvider` in `src/api/server.js` from the abtop bridge
  instead of `async () => null`.
- Decide on the threshold ladder:
  - Hard block at ≥0.99 (today's stub draft)
  - Soft warn at ≥0.95 (rule R6 already demotes, but should the
    preflight surface a "near cap, continue?" prompt to the operator?)
  - Always allow when an explicit `bypass: true` is passed (used by
    tests + an operator override for "I know, do it anyway")

## Open questions

1. **Should preflight short-circuit on local providers?** A local model
   can't run out of "quota" in the API sense, but could fail on RAM
   pressure. Different signal entirely — probably belongs in a separate
   `checkLocalReadiness` rather than overloading this one.
2. **Cost-cap interaction.** Frontdesk rule R4 force-locals when daily
   $ cap is hit, which is enforced upstream. But a direct relaunch
   bypasses R4 too — preflight should *also* check the daily cap, not
   just provider quota. Add a `checkBudgetBeforeSpawn` companion?
3. **Race conditions.** Two simultaneous launches against the same
   provider both pass preflight (each at 0.94), then one of them tips
   over. Probably acceptable — the in-CLI error surfaces the failure —
   but worth thinking about if/when we add scripted batch launches.

## Acceptance for closing this issue

- [ ] abtop-bridge ships `getQuotaForProvider(id)` returning real
      `{ quotaPct, resetAtEpoch }`.
- [ ] `src/api/server.js` wires the real getter into `createLauncher`.
- [ ] Stub source field flips from `'stub'` to `'abtop'`.
- [ ] Integration test: launch against a 0.99-quota fake provider →
      `QUOTA_PREFLIGHT_FAILED`; launch against a 0.5-quota one → spawns.
- [ ] Daily-cap companion check (`checkBudgetBeforeSpawn`) lands in the
      same change or in a sibling issue.
