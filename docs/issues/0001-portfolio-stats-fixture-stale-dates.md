# Issue #0001 — `portfolio-stats.test.js` fails due to stale fixture dates

**Status:** Fixed (this commit)
**Opened:** 2026-04-26
**Severity:** Low (test only — production code unaffected)
**Area:** `test/stats/portfolio-stats.test.js`, `test/api/portfolio.test.js`,
`test/api/sessions.test.js`, `test/integration/telemetry-flow.test.js`

## Summary

Two cases in `test/stats/portfolio-stats.test.js` fail on `main`:

- `scans repos and stores window snapshots` — expects `commitCount === 1`, gets `0`.
- `skips a git wrapper at the projects root and scans child repos` — expects `commitCount === 2`, gets `0`.

## Root cause

The tests build git fixtures with hardcoded commit dates of **2026-04-15**:

```js
git(repoDir, ['commit', '-m', 'init'], {
  GIT_AUTHOR_DATE: '2026-04-15T08:00:00Z',
  GIT_COMMITTER_DATE: '2026-04-15T08:00:00Z',
});
```

Then they assert against `stats.today.commitCount`. The `today` window in
`createPortfolioStatsService` is a rolling 24h window relative to wall-clock
`Date.now()`. Today is **2026-04-26**, so the commits are 11 days old and
fall outside the window — the assertions are correct, the fixtures aren't.

This will silently re-pass for a day every time the dates are bumped, then
rot again. Time-relative assertions need time-relative fixtures.

## Fix

Use `new Date()` (or `Date.now() - N`) when constructing `GIT_AUTHOR_DATE` /
`GIT_COMMITTER_DATE` so the commits always land inside the window the
assertion checks. Same for any window the test exercises (`today`, `7d`,
`30d`).

Sketch:

```js
const todayIso = new Date().toISOString();
git(repoDir, ['commit', '-m', 'init'], {
  GIT_AUTHOR_DATE: todayIso,
  GIT_COMMITTER_DATE: todayIso,
});
```

The session/history rows in test 1 (lines 49–75) hardcode `2026-04-15` too
and need the same treatment.

## Acceptance

- `npm run test:integration` passes cleanly on `main`. ✅
- Re-running the test on any future date still passes (no further fixture
  bumps needed). ✅

## Resolution (2026-04-26)

The same hardcoded-date pattern was found in three additional test files.
All four now use a `pastIso(minutesAgo)` / `nowIso(offsetMs)` helper that
anchors fixtures to `Date.now()`. While fixing this, a second underlying
bug surfaced and was fixed in parallel — see issue #0003 (the watcher's
`sessionId` was being conflated with `history_session.id`, masking the
date-staleness as an FK error in the sessions and telemetry-flow tests).

## Notes

- These tests are correctly classified as integration (they shell out to
  `git` via `execFileSync`) and live in the integration tier per the new
  `npm run test:unit` / `npm run test:integration` split.
- Failure was pre-existing — surfaced during the unit/integration audit on
  2026-04-26. Not introduced by recent commits.
