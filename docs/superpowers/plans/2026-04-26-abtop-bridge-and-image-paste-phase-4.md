# abtop-bridge + clipboard-image paste — Phase 4 (P4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`
> to walk this plan task-by-task. Steps use `- [ ]` checkboxes for tracking.
>
> **Test discipline:** during the TDD inner loop run `npm run test:unit`
> (sub-second). Only run `npm run test:integration` at task-exit and at
> phase-exit — that's where DB-backed and Fastify-graph tests live.

**Goal.** Land the two pieces of P4 that have the highest ROI right now:

1. **abtop-bridge.** Stream live per-session telemetry (CTX %, tokens,
   memory, child-process tree, status) from
   [graykode/abtop](https://github.com/graykode/abtop) into agent-office.
   Powers the drawer timeline and the real preflight quota signal
   (closes issue #0002).
2. **Clipboard-image paste.** Make the in-browser xterm.js panel accept
   pasted images so operators can drop screenshots straight into Claude
   Code / Codex prompts.

**Pivot from architecture spec — 2026-04-26.** The original §P4 in
`implementation-plan.md` bundled abtop-bridge with `pty-hub` (a Rust
sidecar replacement for node-pty) and assumed a `--rpc` JSON-RPC mode
in abtop that doesn't exist yet. Two corrections:

- **abtop already exposes `abtop --once`** — a structured text snapshot
  of all sessions. We poll-and-parse from Node. No Rust changes, no
  upstream dependency, no fork. Contributing a real `--rpc` mode
  upstream becomes a "nice to have" once the bridge has earned its keep.
- **`pty-hub` does not unblock image paste.** Image paste is an
  xterm.js / browser layer concern, not a PTY-backend concern. Bundling
  pty-hub here only inflates scope. node-pty stays. pty-hub is deferred
  to its own future phase if/when node-pty actually hurts.

**Trigger.** P3 is shipped. Multi-provider through the contract works.
The frontdesk routes correctly. The two paper-cuts left:
- Live ops rail still has placeholder context-window bars; preflight
  quota check is a stub.
- Pasting a screenshot into the xterm.js panel does nothing.

**Architecture references.**
- `docs/architecture/agent-commander.md` §3.4 (abtop-bridge), §6.4
  (drawer timeline).
- `docs/architecture/implementation-plan.md` §P4 + §P4 exit checklist
  (note this plan supersedes the pty-hub portions of that spec).
- `docs/issues/0002-preflight-quota-check.md` (the stub this plan
  replaces).
- abtop upstream: <https://github.com/graykode/abtop> (MIT, no API
  keys, read-only).

**Tech stack.** Node 22 ESM · `child_process.spawn` for `abtop --once`
· `node:test` · `@xterm/addon-image` (output) and a custom paste handler
(input) · existing Fastify + ws-bus.

**Out of scope.**
- pty-hub Rust sidecar (deferred to its own phase).
- Contributing `--rpc` mode upstream to abtop (parking lot — re-evaluate
  after the parser-based bridge has run for a while).
- Image *generation* in agent-office. We only handle paste-in.
- Anything Windows-specific. abtop requires Unix tools (`ps`, `lsof`)
  and isn't supported natively on Windows; WSL is recommended.

---

## File Structure

**Create:**
- `src/telemetry/abtop-bridge.js` — `createAbtopBridge({ binPath, pollMs })`
  that spawns `abtop --once`, parses the output, diffs against last
  snapshot, emits `session:detail:tick` on the bus.
- `src/telemetry/abtop-parser.js` — pure parser. Takes the stdout
  string of `abtop --once`, returns `Array<AbtopSession>`.
  Unit-testable without spawning a subprocess.
- `test/telemetry/abtop-parser.test.js` (unit) — fixtures from real
  `abtop --once` output.
- `test/telemetry/abtop-bridge.test.js` (unit) — mocks `child_process.spawn`.
- `src/api/routes/abtop.js` — `GET /api/abtop/snapshot` returns the
  most recent parsed snapshot (UI bootstrap path; ws-bus is the patch
  channel).
- `test/api/abtop.test.js` (integration).
- `ui/src/lib/clipboard-image-paste.js` — pure helper:
  `installClipboardImagePaste(term, { onImage })` returns a teardown
  fn. Listens on the xterm.js host element for `paste`, extracts
  image blobs, calls `onImage(blob)`.
- `ui/src/term/TerminalPane.jsx` — modify (already exists or wherever
  the xterm.js host lives) to wire `xterm-addon-image` (output) and
  the paste handler (input).
- `src/api/routes/paste.js` — `POST /api/paste/image` (multipart) →
  writes blob to `~/.agent-office/paste/<uuid>.<ext>`, returns
  `{ path }`. Stays under data-dir so file is local-only.
- `test/api/paste-image.test.js` (integration).
- `ui/src/term/imagePaste.test.jsx` (unit, optional — DOM event
  simulation. Skip if test scaffolding for ui/ doesn't exist yet.)

**Modify:**
- `src/agents/preflight-quota.js` — replace stub: when an `abtop-bridge`
  snapshot is available, read CTX %, recent rate-limit hits per
  provider, and return `{ ok: false, reason }` with a real signal
  instead of always-true. Keep the injected `getQuotaForProvider`
  shape so existing tests still pass.
- `src/api/server.js` — at boot, when `settings.abtop.enabled !== false`
  and `which abtop` succeeds, construct `createAbtopBridge`, start it,
  expose snapshot via `app.locals.abtopSnapshot()`, wire the
  `getQuotaForProvider` dep on the launcher to read from it.
- `src/core/settings.js` — add `abtop.{ enabled: true, binPath: 'abtop',
  pollMs: 3000 }`. Auto-disable when binary not on PATH.
- `bin/agent-office.js` — `agent-office doctor` adds an "abtop on PATH"
  check.
- `ui/src/dashboard/SessionDrawer.jsx` (or wherever the drawer lives) —
  consume the new `session:detail:tick` ws topic to render per-call
  timeline bars.
- `package.json` — `@xterm/addon-image` dep; add the new test files to
  `test:unit` glob (parser test) and `test:integration` (bridge,
  routes, paste flow).

**Delete:**
- Nothing.

---

## Tasks

### Track A — abtop-bridge

#### Task A1 — Capture real `abtop --once` fixtures
- [ ] Run `abtop --once > test/fixtures/abtop/two-sessions.txt` on a
  machine with 2+ live agent sessions; commit the fixture.
- [ ] Capture a second fixture with the rate-limit indicator visible
  (run abtop after a 429 hit) → `rate-limited.txt`. If you can't
  reproduce, hand-edit the first fixture to inject the line shape and
  document it in a comment at the top of the file.
- [ ] Capture a "no sessions" fixture → `empty.txt`.

#### Task A2 — Pure parser (`abtop-parser.js`)
- [ ] Parse the header (`abtop — N sessions`).
- [ ] Parse one session block per top-level PID line. Extract:
  - `pid`, `projectName`, `projectId` (the `(thread_id)` suffix), `currentTask`,
  - `status` (Wait | Think | Tool | Idle, mapped from the unicode glyphs),
  - `model`, `ctxPct`, `tokensTotal`, `memMB`, `wallTime` (parsed to seconds).
- [ ] Parse the `└─` last-action line per session.
- [ ] Parse the indented child PID list per session (PID, command, mem).
- [ ] Return `Array<AbtopSession>`. Pure — no I/O.
- [ ] **Test (unit):** every fixture round-trips into the expected
  shape. Hand-edited rate-limit line is recognized via a sentinel.

#### Task A3 — `createAbtopBridge`
- [ ] Spawn `${binPath} --once` every `pollMs` (default 3000ms). Use
  `execFile` with a 2s timeout — if abtop hangs, log a warning and
  schedule the next tick. Never throw into the loop.
- [ ] Parse stdout via Task A2. Compare against the last snapshot;
  emit `session:detail:tick` on the bus only for sessions whose
  fields actually changed.
- [ ] Expose `bridge.snapshot()` (sync, returns the cached parse) and
  `bridge.start()` / `bridge.stop()`.
- [ ] **Test (unit):** mock `child_process.execFile` to return a
  fixture buffer; assert `snapshot()` matches expected shape and
  `session:detail:tick` is emitted only on change.

#### Task A4 — Wire into Fastify boot
- [ ] In `src/api/server.js`: when settings allow and the binary is on
  PATH, construct the bridge and `await bridge.start()`. Stash on
  `app.locals.abtopBridge` so test code and the snapshot route can
  reach it. Tear down on shutdown.
- [ ] `GET /api/abtop/snapshot` returns `{ data: bridge.snapshot(), error: null }`.
- [ ] **Test (integration):** boot Fastify with a stubbed bridge
  (returns a fixed array); GET the route, assert shape.

#### Task A5 — Real preflight quota signal (closes issue #0002)
- [ ] In `src/agents/preflight-quota.js`: when an `abtopSnapshot()` getter
  is injected, look up the most-recent session for `providerId`, read
  `ctxPct`, and reject when `ctxPct >= 0.99`. Keep the existing
  `getQuotaForProvider` shape as a fallback.
- [ ] In `src/api/server.js`: pass
  `getQuotaForProvider: (id) => deriveQuotaFromAbtop(app.locals.abtopBridge?.snapshot(), id)`
  to the launcher and the frontdesk runner. Sessions over 95% trigger
  R5 (drop), 80–95% trigger R6 (demote) — finally with real numbers.
- [ ] **Test (unit):** `preflight-quota.test.js` — a fake
  `abtopSnapshot()` returning `{ ctxPct: 0.99 }` blocks the spawn;
  `0.50` lets it through.
- [ ] Mark issue #0002 closed in the doc.

#### Task A6 — Drawer timeline (per-call bars)
- [ ] `ui/src/dashboard/SessionDrawer.jsx` (or the v2 equivalent) reads
  the `session:detail:tick` topic, renders one bar per child-process
  + one bar for context-window fill, color-coded.
- [ ] First-paint hits `GET /api/abtop/snapshot`, then patches from WS.
- [ ] No new test discipline beyond eyeballing — add a manual smoke
  step in the PR description.

### Track B — clipboard-image paste

#### Task B1 — Backend paste endpoint
- [ ] `POST /api/paste/image` accepts a multipart file upload **OR** a
  base64 JSON body. Limits: max 10 MB, allowed mimes
  `image/png|jpeg|gif|webp`.
- [ ] Saves to `~/.agent-office/paste/<uuid>.<ext>`. Returns
  `{ data: { path }, error: null }`. Local-only — never leaves disk.
- [ ] Optional: a daily cleanup of files > 7 days old (cron-style call
  inside the route plugin's `onReady` is fine).
- [ ] **Test (integration):** POST a 1×1 PNG; assert the file lands on
  disk and the response carries the absolute path.

#### Task B2 — `xterm-addon-image` (output side)
- [ ] `npm install @xterm/addon-image` in `ui/`.
- [ ] Load and `term.loadAddon(new ImageAddon())` in
  `ui/src/term/TerminalPane.jsx` at the same place other addons are
  registered.
- [ ] Manual smoke: run `imgcat ./screenshot.png` (iTerm protocol) or
  `display ./foo.sixel` inside a terminal session and confirm the
  image renders inline.

#### Task B3 — `installClipboardImagePaste(term, { onImage })`
- [ ] Pure helper module under `ui/src/lib/clipboard-image-paste.js`.
- [ ] Listens for `paste` on the xterm.js host element. Walks
  `clipboardData.items`, picks the first `image/*` blob, calls
  `onImage(blob)`. If no image, falls through to xterm.js's default
  paste handling (text).
- [ ] Returns a teardown function for React `useEffect` cleanup.
- [ ] **Test (unit, optional):** if any UI test scaffolding exists,
  simulate a paste event with a mock `clipboardData`; assert
  `onImage` is called with the blob. Skip if there's no harness.

#### Task B4 — Wire B1 + B2 + B3 in `TerminalPane.jsx`
- [ ] On image paste: POST blob to `/api/paste/image`, get `{ path }`,
  call `term.paste(path + ' ')` so the path lands at the cursor like
  any other text.
- [ ] Operator workflow: ⌘V over xterm.js → path appears at the
  cursor → operator hits Enter / continues typing. Claude Code
  recognizes file paths as image references natively.
- [ ] Manual smoke step in the PR description: paste a Cmd+Shift+4
  screenshot into a `claude` session, confirm the image attachment.

### Track C — settings, doctor, packaging

#### Task C1 — Settings + CLI surface
- [ ] `src/core/settings.js` adds `abtop.{ enabled: true, binPath: 'abtop', pollMs: 3000 }`.
- [ ] `agent-office doctor` adds an "abtop on PATH" check (uses the
  same `commandOnPath` helper as the others).
- [ ] `agent-office providers list` already shows aider-local health;
  add an "abtop bridge: ✓ running / ✗ not installed" line at the
  bottom for visibility.
- [ ] **Test (unit):** trivial — already covered by the existing
  doctor/list smoke checks; just add a fixture line.

---

## Acceptance (P4 exit checklist)

Adapted from `implementation-plan.md` §P4 exit, scoped to this plan:

- [ ] **abtop bridge shipped** (Tasks A1–A4) — running locally, polling
  `abtop --once`, fanning into ws-bus.
- [ ] **Drawer timeline shows real per-call data** (Task A6) — eyeball
  test in the PR description.
- [ ] **Preflight quota check uses real signals** (Task A5) — issue
  #0002 closed.
- [ ] **Clipboard-image paste works end-to-end** (Tasks B1–B4) —
  pasting a screenshot into a `claude` session attaches it.
- [ ] **Both PTY backends pass the matrix** — *omitted from this plan*;
  pty-hub is deferred. node-pty alone has to keep passing the existing
  P0 + P3 matrix tests, which it already does.

**Functional acceptance scenarios.**

1. Open the dashboard with two live `claude` sessions in different
   projects. The drawer shows real CTX% bars that move as the model
   thinks. Kill one session — the row disappears within `pollMs`.
2. Take a screenshot (`Cmd+Shift+4`), focus the xterm.js panel,
   `Cmd+V`. The path of the saved image appears at the cursor.
   Submit the prompt. Claude Code attaches the image.
3. Trigger R5 by capping the agent against `abtop`'s rate-limit
   detection — the next launch through that provider gets blocked
   pre-spawn with the real reason, not a stub.

---

## Risks / open questions

- **abtop output format is not a contract.** If a future abtop release
  changes the line shape, the parser breaks. Mitigation: pin `abtop`
  to a known-good version in `agent-office doctor`'s output, keep a
  fixture per supported abtop version, and write the parser to
  *degrade* (log + return what it could parse) rather than throw.
  Long-term mitigation: contribute `--json` upstream once the bridge
  has earned its keep.
- **Polling cost.** `abtop --once` is fast (<100ms on this machine),
  but spawning a process every 3s adds ~30 spawns/min. Acceptable
  initially — revisit if it shows up in flame graphs. The bridge can
  fall back to longer `pollMs` when there are zero live sessions.
- **Image paste size.** A 4K screenshot is ~5–10 MB; the 10 MB cap
  is generous. Above that, the operator should attach by drag-drop,
  not paste. Document in the README.
- **Path-based image attachment isn't universal.** Claude Code accepts
  file paths in prompts; Codex and Gemini have their own conventions.
  In v1, B4 only guarantees the Claude flow works; document the
  per-provider story and revisit in a follow-up if the others' paste
  UX is poor.
- **Stripe test key visible in abtop output.** While developing this
  plan, the assistant noticed an `sk_test_…` Stripe API key leaking
  into `abtop --once` output via a child-process command line of an
  unrelated MCP server. Test keys are low-risk but the parser MUST
  redact `sk_(test|live)_[A-Za-z0-9]+`, AWS keys (`AKIA…`), GitHub
  tokens (`gh[ps]_…`), and Anthropic/OpenAI keys before they hit
  ws-bus. Treat redaction as a hard gate, not an enhancement.

## Why not pty-hub

Bundled into the original §P4 spec, removed from this plan. Reasoning:
- node-pty has not actually hit a wall in P0–P3 testing.
- pty-hub is a non-trivial Rust sidecar (portable-pty + tokio +
  tungstenite + replay buffer + a settings switch). Multi-day project.
- The headline P4 wins (live telemetry, image paste) do *not* depend
  on it. Image paste is browser/xterm.js layer; abtop-bridge is Node
  layer.
- Replay buffer on browser reload is genuinely nice but not a
  blocker today — the dashboard re-bootstraps from REST + WS within
  a second.

If a future heavy interactive session demonstrates a node-pty wall
(rendering glitches we can't fix in xterm.js, hangs under burst I/O),
file an issue and write a focused pty-hub plan then. Until then, it's
speculation.
