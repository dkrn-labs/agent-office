# Agent Commander — Target-State Architecture

**Version:** v2 design  ·  **Status:** target state, not as-is  ·  **Owner:** DK

This document describes the intended architecture for `agent-office` once the
v2 UI and the hybrid frontdesk router are in place. It supersedes the
sprite-office launch wizard. Phase-1 unified history (commits up through
`2d0afa8`) and the existing provider hooks are kept; everything else is
either added, restructured, or replaced.

---

## 1 · Vision

`agent-office` is a single-user **agent commander** that sits between a human
operator and a fleet of CLI coding agents (Claude Code, Codex, Gemini CLI,
plus local Ollama-backed CLIs). It does four things:

1. **Watches.** It knows what every agent is doing in real time — context
   usage, token burn, cache hit rate, child processes, port bindings, tool
   timeline — across all CLIs, even sessions launched outside the wrapper.
2. **Remembers.** It records every session in one canonical SQLite store
   (`history_session` and friends), regardless of which CLI produced it.
3. **Routes.** When the operator describes a task, a hybrid
   rules+LLM **frontdesk** picks the right persona, the right provider
   (cloud or local), the right history items, and the right skills — then
   pre-fills the launcher wizard.
4. **Saves tokens.** Every launch loads only the context that's relevant,
   and the system reports cumulative savings vs a "naive baseline" (load
   everything) so the value is auditable.

The headline UI is the **terminal + live ops** pair, with telemetry on top
and the launcher just above the terminal. Everything else is a means to
support that pair.

---

## 2 · System map

```
┌────────────────────────────── operator ──────────────────────────────┐
│                                                                      │
│                    React UI (Vite, Zustand, xterm.js)                │
│                                                                      │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ REST + WebSocket (single origin :3334)
                                 ▼
┌──────────────────────────── ao-core (Node + Fastify) ────────────────┐
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌──────────────┐        │
│  │ launcher │  │ frontdesk│  │  history-  │  │ context-     │        │
│  │          │  │ (rules+  │  │  ingest    │  │ budget +     │        │
│  │          │  │  LLM)    │  │            │  │ savings      │        │
│  └─────┬────┘  └─────┬────┘  └──────┬─────┘  └──────┬───────┘        │
│        │             │              │               │                │
│  ┌─────▼────┐  ┌─────▼────┐  ┌──────▼─────┐  ┌──────▼───────┐        │
│  │ provider │  │ persona- │  │  project-  │  │ ws-bus       │        │
│  │ adapters │  │ registry │  │  scanner   │  │ (pub/sub)    │        │
│  └─────┬────┘  └──────────┘  └──────┬─────┘  └──────┬───────┘        │
│        │                            │               │                │
└────────┼────────────────────────────┼───────────────┼────────────────┘
         │                            │               │
         ▼                            ▼               ▼
   ┌──────────┐              ┌──────────────┐    ┌──────────┐
   │  PTYs    │              │ ~/.agent-    │    │ subscribe│
   │ via      │              │ office/      │    │ rs (UI,  │
   │ pty-hub  │              │ agent-office │    │ logs)    │
   │ (Rust)   │              │ .db (sqlite) │    │          │
   └──────────┘              └──────────────┘    └──────────┘

   sidecars (out-of-process):
   ┌────────────────────────┐    ┌──────────────────────────┐
   │ abtop-bridge (Rust)    │    │ provider hooks + watchers│
   │ quota · ctx% · ports   │    │ claude/codex/gemini      │
   │ proc tree · timeline   │    │ POST /api/history/ingest │
   └────────────────────────┘    └──────────────────────────┘

   external integrations:
   ┌────────────────────────┐    ┌──────────────────────────┐
   │ gh-bridge (Octokit)    │    │ ollama-bridge (HTTP)     │
   │ commits · PRs · issues │    │ /api/ps · /api/chat      │
   └────────────────────────┘    └──────────────────────────┘
```

Everything terminates at `ao-core`. The UI never talks to a sidecar
directly. Sidecars exist only where a non-Node language buys something
concrete (`abtop` already exists in Rust; PTY multiplexing benefits from
Rust under load).

---

## 3 · Architectural principles

These constraints are load-bearing — every component below is designed to
honor them.

| # | Principle | Consequence |
|---|---|---|
| 1 | **One process to start, one DB to back up.** | `ao-core` is a single Fastify process. SQLite WAL is the single source of truth. Sidecars are optional accelerators. |
| 2 | **Deterministic rules run before any LLM.** | Frontdesk has a rule chain that can short-circuit (privacy, quota, attach-vs-launch). The LLM only gets called inside the lane rules define. |
| 3 | **Every provider is an adapter.** | No `if (provider === 'claude-code')` branches outside `src/providers/`. New CLIs (Ollama, Aider, Goose) plug in by implementing one interface. |
| 4 | **Local equals cloud at the contract level.** | Local providers report cost as `$0` but also a `cloudEquivalent` so the savings ledger can credit them properly. |
| 5 | **History is canonical; abtop is enrichment.** | The sqlite store is the durable record. abtop fills in *live* runtime fields (context%, mem, ports) that don't fit a post-session ingestion model. If abtop is unavailable, the system still works. |
| 6 | **Token efficiency is observable.** | Every launch persists `baseline_tokens` and `optimized_tokens`. The savings pill is real, weighted by outcome. |
| 7 | **No multi-user, no auth-server.** | Single-user local tool. Loopback-only binding. Per-process token gates the ingest endpoint. Don't ship to LAN without rethinking. |

---

## 4 · Component catalog

### 4.1 ao-core (Node, Fastify)

The single API process. Modular internally; deployed as one binary.

| Module | Responsibility | Notes |
|---|---|---|
| `api/` | Fastify routes (REST + WS upgrade). Zod schemas for every endpoint. | One origin, one port (`:3334`). |
| `launcher/` | Builds prompt + skills + history into a launch context, requests a PTY, persists `history_session` row pre-spawn, emits `session:start`. | Replaces the current `osascript` iTerm spawning with a `pty-hub` request. |
| `frontdesk/` | Two-stage router: `rules.js` then `llm.js`. Outputs a proposal. Logs every decision to `frontdesk_decision`. | See §6. |
| `history/` | Ingest, query, persona-filter, getLaunchHistory. Wraps SQLite. | Schema is the existing migration 004 plus additions in §7. |
| `context-budget/` | Computes baseline and optimized token counts per launch; persists to `launch_budget`. | Drives the savings pill. |
| `savings-ledger/` | Rolls up `launch_budget` over today/7d/30d, weighted by outcome. | Outcome `rejected` does *not* count as savings. |
| `personas/` | Persona CRUD; built-in seed; domain → filter regex map. | Existing module. |
| `projects/` | Project scanner, pin/recent/active grouping. | Existing module, extended with gh-bridge data. |
| `providers/` | Adapter registry; manifest of installed providers; provider state cache. | See §5. |
| `ws-bus/` | Internal pub/sub plus a WS-fan-out endpoint. | Topics: `quota:*`, `session:*`, `savings:*`, `project:*`, `frontdesk:*`. |
| `auth/` | Loopback verification + per-process token for hooks calling `/api/history/ingest`. | Token rotated on `ao-core` start. |

### 4.2 Sidecars

| Sidecar | Tech | Why separate | Spoken to via |
|---|---|---|---|
| **abtop-bridge** | Rust (existing `abtop` + a JSON-RPC mode to add) | Already does OS-level inspection (PIDs, TTYs, sqlite tails) in Rust. Re-implementing in Node is redundant and slower. | UNIX socket `~/.agent-office/abtop.sock`, line-delimited JSON-RPC |
| **pty-hub** | Rust (`portable-pty` + `tokio` + `tungstenite`) | `node-pty` works but has pathological behavior under heavy TUI traffic (claude's interactive UI). Rust gives us reliable resize, replay buffer, multiplexing. | UNIX socket for control; WS for IO (proxied through `ao-core`) |

Both are optional. If neither is installed, `ao-core` falls back to:
- abtop → polling watchers (existing `codex-watcher`, `gemini-watcher`) + `ps`/`lsof` for runtime
- pty-hub → `node-pty` in-process

### 4.3 Provider hooks + watchers (existing, extended)

Live in `~/.claude/`, `~/.codex/`, `~/.gemini/` (and any new adapter's hook
location). Post-session, they POST to `/api/history/ingest` with a payload
that includes `historySessionId` (set by launcher pre-spawn). Watchers
exist as fallback when hooks miss. Everything below the API line is
unchanged; what's missing today (Gemini AfterAgent never fires, Codex
watcher orphans rows) is in the open issue list, not redesigned.

### 4.4 External integrations

| Integration | Purpose | Cache TTL |
|---|---|---|
| **gh-bridge** (Octokit + `gh` fallback) | Commits today, PRs open, issues, last commit per project. Drives the project ticker. | 60s |
| **ollama-bridge** (HTTP, localhost:11434) | `/api/ps` for loaded models + GPU mem; `/api/chat` for streaming runs of local CLIs that delegate to Ollama. | live |

### 4.5 Frontend

| Component | Source data | Lives in |
|---|---|---|
| `Header` + ambient sprite strip | personas, live-sessions | `ui/src/layout/` |
| `QuotaRow` + `SavingsPill` | abtop-bridge, savings-ledger | `ui/src/telemetry/` |
| `ProjectTicker` (sliding marquee) | gh-bridge + project-scanner | `ui/src/telemetry/` |
| `LiveOpsRail` + `RailCard` | abtop-bridge per-session + history-ingest | `ui/src/ops/` |
| `ExpandDrawer` (slide-over) | abtop-bridge `session:detail` | `ui/src/ops/` |
| `LauncherPanel` shell | — | `ui/src/launcher/` |
| `Frontdesk Pre-fill` button | frontdesk router | `ui/src/launcher/` |
| `WizardRow` combos (persona / project / history / skills) | persona-registry · projects · history · skills | `ui/src/launcher/` |
| `Launch` button | context-budget (live recompute) | `ui/src/launcher/` |
| `TerminalDock` + `XTermPane` | pty-hub WS | `ui/src/term/` |
| `ws-client` | ws-bus | `ui/src/lib/` |

State is in zustand slices — one per major subsystem so the WS client can
fan events out cleanly. xterm.js + `xterm-addon-fit` + `xterm-addon-web-links`.

---

## 5 · Provider Adapter contract

This is the single most important extensibility point. Every CLI agent —
cloud or local — implements the same interface. The launcher, frontdesk,
savings ledger, and UI all consume only the contract; they do not branch
on provider id.

```ts
// src/providers/types.ts
export type ProviderKind = 'cloud' | 'local';

export type SpawnRecipe = {
  argv: string[];                          // ['claude', '--model', '...', '--append-system-prompt', ...]
  env: Record<string, string>;             // includes AGENT_OFFICE_HISTORY_SESSION_ID
  promptDelivery: 'stdin' | 'file' | 'flag';
  promptFlag?: string;                     // when promptDelivery === 'flag'
  cwd: string;
};

export type QuotaWindow = {
  fivehour: { used: number; limit: number; resetAt: string };
  sevenday: { used: number; limit: number; resetAt: string };
};

export type LiveSample = {
  pid: number;
  contextPct: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  model: string;
  turn: number;
  memoryMB: number;
};

export type Usage = { input: number; output: number; cacheRead?: number; cacheWrite?: number };
export type CostBreakdown = {
  dollars: number;          // 0 for local
  cloudEquivalent?: number; // what this would have cost on a cloud peer
  energyWh?: number;        // optional, for local
};

export interface ProviderAdapter {
  readonly id: string;                     // 'claude-code', 'ollama-aider', ...
  readonly label: string;                  // 'Aider · llama3.1:70b'
  readonly kind: ProviderKind;
  readonly bin: string;                    // resolved via PATH at boot

  // Required
  spawn(ctx: LaunchContext): SpawnRecipe;
  cost(usage: Usage, model: string): CostBreakdown;

  // Optional — implement if available
  installHook?(): Promise<void>;           // installs post-session hook into provider's config dir
  parseTranscript?(path: string): Observation[]; // fallback when hook misses
  telemetry?: {
    sample(pid: number): Promise<LiveSample | null>; // live live-ops data
  };
  quota?(): Promise<QuotaWindow | null>;   // null for local

  // Frontdesk hints — used by rules and LLM
  capabilities: {
    toolUse: boolean;
    largeContext: number;                  // max tokens
    streaming: boolean;
    visionInput: boolean;
  };
  modelCatalog: Array<{
    id: string;
    tier: 'small' | 'mid' | 'large';
    contextWindow: number;
    costInPer1k: number;                   // 0 for local
    costOutPer1k: number;
  }>;
}
```

### 5.1 Adapter manifest

`src/providers/manifest.js` is just an array — the registry boots from
this file plus any `~/.agent-office/providers/*.js` user-installed extras.

```js
// src/providers/manifest.js
import claudeCode from './claude-code.js';
import codex from './codex.js';
import gemini from './gemini.js';
import ollamaAider from './ollama-aider.js';

export default [claudeCode, codex, gemini, ollamaAider];
```

Adding a new CLI is a single-file drop-in. No core changes.

### 5.2 Reference: cloud vs local

| Surface | Cloud adapter | Local adapter |
|---|---|---|
| `spawn` | flag-based prompt (`--append-system-prompt`) | usually `stdin` (Aider, Goose) |
| `installHook` | writes to provider's settings.json | optional — local CLIs often don't have hook systems, fall back to `parseTranscript` |
| `telemetry.sample` | reads from abtop-bridge | reads from `ollama-bridge` (`/api/show`, `/api/ps`) |
| `quota` | real numbers | always `null` |
| `cost` | provider pricing | `dollars: 0`, `cloudEquivalent` filled in vs Sonnet |

---

## 6 · Frontdesk — hybrid router

Two stages, in order. The LLM never runs without rules-output as input.

### 6.1 Stage 1: Deterministic rules

Rules live in `src/frontdesk/rules.js` as data. Each rule has shape:

```ts
type Rule = {
  id: string;
  description: string;
  kind: 'hard' | 'soft';
  when: (state: OfficeState, task: TaskInput) => boolean;
  then: (out: Candidates) => Candidates; // pure
};
```

`OfficeState` is a snapshot — quota, active sessions, providers, prefs,
recent project activity. The runner walks rules in order, accumulating
hard constraints and pruning candidate sets.

The canonical chain (target):

| # | Rule | Kind | Effect |
|---|---|---|---|
| 1 | Active session matches `{persona, project}` | hard | Propose **attach** instead of launch |
| 2 | Task contains secrets/PII tokens (`api_key`, `.env`, customer name list) | hard | `mustBeLocal = true` |
| 3 | User pref `privacyMode = strict` | hard | `mustBeLocal = true` |
| 4 | Today's spend ≥ daily $ cap | hard | `mustBeLocal = true` |
| 5 | Provider quota > 95% | soft | Drop provider |
| 6 | Provider quota 80–95% | soft | Demote provider in scoring |
| 7 | `mustBeLocal` but no local model loaded | hard | Block launch with actionable error |
| 8 | Verbs `deploy / release / rollback` | soft | Restrict persona to `devops` |
| 9 | Verbs `debug / fix / crash / error` | soft | Bias `debug` |
| 10 | Short task + mechanical verbs (`rename / format / add comment`) | soft | Tag `oneshot`, prefer cheap/local |
| 11 | "across the codebase" / "refactor X to Y" / >500-char task | soft | Tag `long-running`, prefer Opus/Sonnet |
| 12 | Cross-project switch from current cache | soft | Penalty (cache miss cost) |
| 13 | Persona `frontdesk` or `lead` | hard | Never auto-pick |
| 14 | Persona domain `review` and no recent diff/PR | soft | Drop reviewer |
| 15 | History candidate score < 0.4 | soft | Auto-exclude from pre-fill |
| 16 | Pre-fill total > 12k tokens | soft | Trim lowest-score history until under cap |

Outputs a `Candidates` object: `{personas[], providers[], history[], skills[], constraints, rulesApplied[]}`.

### 6.2 Stage 2: LLM reasoner

Model: **Claude Haiku 4.5** with prompt caching. Why Haiku: this is a
high-frequency, low-stakes routing decision. Sonnet is overkill.

**Prompt structure** (cacheable parts marked):

| Part | Cached? | Refresh on |
|---|---|---|
| System: "You are the frontdesk for an agent office..." | ✅ | code release |
| Persona catalog (domain, prompt template, default skills) | ✅ | persona edit |
| Skill catalog (id, label, description, token cost) | ✅ | skill registry edit |
| Rule chain summary (so LLM knows what's already enforced) | ✅ | rules.js change |
| Recent successful frontdesk decisions (5 few-shots) | ⚠️ | every 24h |
| Dynamic: task text, candidates, rule trace, project state | ❌ | every call |

Cached prefix lands at ~6k tokens. Dynamic suffix ~1k. Output ~300. Per-call cost when cache hits: ~$0.0001.

**Output schema** (Zod-validated):

```ts
{
  persona: string,
  provider: string,
  model: string,
  taskType: 'oneshot' | 'iterative' | 'long-running',
  estimatedDuration: '<5min' | '5-30min' | '>30min',
  complexity: 1..10,
  history_picks: string[],
  skills_picks: string[],
  reasoning: string,                    // 1-2 sentences for the UI
  fallback_if_blocked?: { provider, reason }
}
```

If LLM output fails schema, frontdesk falls back to "first candidate of
each type" — never blocks a launch on a router hiccup.

### 6.3 Learning loop

Every decision is written to `frontdesk_decision`:

```sql
CREATE TABLE frontdesk_decision (
  id INTEGER PRIMARY KEY,
  task_hash TEXT,
  rules_applied JSON,
  llm_input JSON,
  llm_output JSON,
  user_accepted JSON,         -- what the user actually launched with
  outcome TEXT,               -- 'accepted' | 'partial' | 'rejected'
  created_at INTEGER
);
```

The 5-shot block in §6.2 is sampled from `outcome = 'accepted'` rows where
`user_accepted == llm_output`. That's the cheap learning loop: the system
gets sharper without any retraining, just by remembering its successes.

---

## 7 · Data model

One SQLite file: `~/.agent-office/agent-office.db` (WAL). Existing tables
from Phase 1 are kept verbatim. Additions:

```sql
-- launch budget: drives the savings pill
CREATE TABLE launch_budget (
  launch_id TEXT PRIMARY KEY REFERENCES history_session(history_session_id),
  baseline_tokens INTEGER NOT NULL,         -- "naive: load everything"
  optimized_tokens INTEGER NOT NULL,        -- what was actually sent
  baseline_breakdown JSON,                  -- per-bucket
  optimized_breakdown JSON,
  outcome TEXT,                             -- 'accepted'|'partial'|'rejected', filled at session end
  cost_dollars REAL,                        -- via adapter cost()
  cloud_equivalent_dollars REAL,            -- for local
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_launch_budget_created ON launch_budget(created_at);

-- frontdesk decision log (see §6.3)
CREATE TABLE frontdesk_decision (...);

-- provider state cache (so quota survives restart)
CREATE TABLE provider_state (
  provider_id TEXT PRIMARY KEY,
  quota JSON,
  refreshed_at INTEGER
);

-- user prefs
CREATE TABLE user_pref (
  key TEXT PRIMARY KEY,
  value JSON,
  updated_at INTEGER
);
-- seeded keys: privacyMode, dailyDollarCap, preferLocal, defaultModel,
--              cloudEquivalentBaselineModel
```

No external DB. Migration to Turso/libsql is a swap of the driver — same
SQL — if you ever need cross-machine.

---

## 8 · API surface

REST is small and uniform. Every endpoint validates with Zod. WS is the
async fan-out path.

### 8.1 REST

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/quota` | Full quota panel snapshot |
| GET | `/api/savings?range=today\|7d\|30d` | Savings ledger rollup |
| GET | `/api/projects` | All projects with grouping |
| GET | `/api/projects/active` | Live projects only |
| GET | `/api/projects/activity` | Project ticker payload |
| GET | `/api/projects/:id/history?persona=&limit=` | Filtered history candidates |
| GET | `/api/personas` | Persona catalog |
| GET | `/api/skills?persona=` | Skill candidates with persona scoring |
| GET | `/api/sessions/live` | Live ops rail |
| GET | `/api/sessions/recent` | Recently finished |
| GET | `/api/sessions/:id/detail` | Drawer data (children/subagents/timeline) |
| POST | `/api/frontdesk/route` | Body `{task}` → proposal |
| POST | `/api/launch` | Body: full launch context → returns `{historySessionId, ptyId}` |
| POST | `/api/history/ingest` | Provider hooks post here (token-gated) |
| POST | `/api/sessions/:id/outcome` | User marks outcome at session end |

### 8.2 WS topics

Single endpoint `/ws`; client subscribes to topics.

| Topic | Frequency | Payload |
|---|---|---|
| `quota:tick` | 1 Hz | quota panel delta |
| `savings:tick` | on session close | new totals |
| `session:start` | event | new live session |
| `session:update` | 1 Hz per active | live sample |
| `session:end` | event | final state + outcome prompt |
| `session:detail:tick` | 2 Hz, only while a drawer is open | timeline + child procs |
| `project:activity` | 60s | gh-bridge refresh |
| `frontdesk:proposal` | event | streaming proposal (if you want live pre-fill) |
| `pty:io` | per output chunk | terminal bytes |

---

## 9 · Telemetry & savings ledger

### 9.1 Token accounting

For every launch, persist both numbers:

- **Baseline** = what the launch *would* have cost with no filtering: full
  system prompt + all installed skills + last N observations unfiltered +
  full project memory dump. Computed once at launch time.
- **Optimized** = what actually got sent. Already tracked.

Saved tokens = `baseline - optimized`, but only credit it when
`outcome != 'rejected'`. A botched launch that was cheap doesn't count as
savings.

### 9.2 Local-vs-cloud framing

For local providers, `cost.dollars = 0`, but the savings panel can still
show value via `cloudEquivalent`:

```
Saved 412k tokens · $1.24 cost avoided
   of which:
     – 280k via context filtering
     – 132k via routing to Ollama (≈ $0.40 vs Sonnet)
```

That makes the local-routing decision visible. Without this, local
sessions look free in $ terms and the frontdesk's choice to route locally
is invisible.

### 9.3 Outcome tagging

At session end, prompt the operator with a one-click outcome:
`accepted / partial / rejected`. Default to `accepted` if user just closes
the terminal cleanly; default `partial` if the session was killed; default
`rejected` if user explicitly marks it. The outcome flows back into both
`launch_budget` and `frontdesk_decision`.

---

## 10 · Security & privacy

This is single-user local. Threat model is "rogue process on the same
machine," not "remote attacker." Posture:

- Bind `ao-core` to `127.0.0.1` only.
- Generate an `AGENT_OFFICE_INGEST_TOKEN` at boot, write to
  `~/.agent-office/ingest.token` (mode 0600). Hooks read it; the
  `/api/history/ingest` endpoint requires it. Rotated every restart.
- Never log task text or transcripts at INFO level. Redact before
  logging.
- `privacyMode = strict` user pref forces local providers and disables
  the LLM router (rules-only). Useful when working with regulated data.
- Frontdesk decision log includes `task_hash` (sha256), not raw task —
  so the learning few-shots can be sampled without exposing past prompts.

What's deliberately **not** in scope: multi-user, network access, RBAC,
encryption-at-rest. If those become requirements, this design changes
shape — say so before.

---

## 11 · Configuration

Single config file at `~/.agent-office/settings.json`:

```jsonc
{
  "core": {
    "port": 3334,
    "logLevel": "info"
  },
  "user": {
    "privacyMode": "normal",                   // 'normal' | 'strict'
    "dailyDollarCap": 5.00,
    "preferLocal": false,
    "cloudEquivalentBaselineModel": "claude-sonnet-4.6"
  },
  "providers": {
    "claude-code": { "enabled": true },
    "codex": { "enabled": true },
    "gemini-cli": { "enabled": true },
    "ollama-aider": { "enabled": true, "model": "qwen2.5-coder:32b" }
  },
  "frontdesk": {
    "llm": {
      "provider": "anthropic",
      "model": "claude-haiku-4-5",
      "enabled": true                          // false → rules-only
    },
    "rules": "src/frontdesk/rules.js"          // can be overridden
  },
  "ui": {
    "ticker": { "enabled": true, "speedSeconds": 80 },
    "ambientSprites": true
  }
}
```

User prefs are also mirrored into `user_pref` so they're queryable from
SQL — UI reads from API, hot rules read from in-memory snapshot kept in
sync via the `pref:update` WS topic.

---

## 12 · Build & runtime layout

```
agent-office/
├── ao-core/                       # Node, Fastify
│   ├── src/
│   │   ├── api/                   # Fastify routes
│   │   ├── launcher/
│   │   ├── frontdesk/
│   │   │   ├── rules.js           # rule chain (data)
│   │   │   ├── runner.js          # rule evaluator
│   │   │   └── llm.js             # Haiku reasoner
│   │   ├── history/
│   │   ├── context-budget/
│   │   ├── savings-ledger/
│   │   ├── personas/
│   │   ├── projects/
│   │   ├── providers/
│   │   │   ├── types.ts
│   │   │   ├── manifest.js
│   │   │   ├── claude-code.js
│   │   │   ├── codex.js
│   │   │   ├── gemini.js
│   │   │   └── ollama-aider.js
│   │   ├── ws-bus/
│   │   └── auth/
│   └── test/
├── sidecars/
│   ├── abtop-bridge/              # Rust (lives in abtop repo, exposes JSON-RPC)
│   └── pty-hub/                   # Rust
├── ui/                            # Vite + React
│   └── src/
│       ├── layout/
│       ├── telemetry/
│       ├── ops/
│       ├── launcher/
│       ├── term/
│       ├── lib/
│       └── stores/
├── docs/
│   └── architecture/
│       └── agent-commander.md     # this file
└── scripts/
    ├── provider-history-hook.js   # existing
    └── install-hooks.js           # one-shot installer per adapter
```

Process layout at runtime:

```
launchctl / brew services
  ├─ ao-core (node)                       :3334
  ├─ abtop-bridge (rust, optional)        unix:abtop.sock
  └─ pty-hub (rust, optional)             unix:pty.sock + tcp:5800 (for WS)
```

A single `ao-core` is the only must-run; sidecars are best-effort.

---

## 13 · Observability

`ao-core` exposes:

- `/api/_health` — liveness
- `/api/_metrics` — prometheus-style counters: `frontdesk_decisions_total`,
  `launch_budget_saved_tokens_total`, `provider_quota_remaining{provider}`,
  `pty_sessions_active`
- Structured logs to `~/.agent-office/logs/ao-core.log` (rotated). Log
  level via env `AO_LOG_LEVEL`.

The UI itself is *also* observable via the savings pill — it answers "is
this thing earning its keep?" without grepping logs.

---

## 14 · Future expansions

Things the architecture is ready for, in roughly the order they'd be added:

1. **More provider adapters.** Aider, Goose, Crush, Mods, OpenCode,
   any Ollama-fronted CLI. Each is a single-file drop-in.
2. **Subagent spawning.** Once Claude Code starts dispatching subagents,
   the live-ops rail's drawer already has a "Subagents" panel that
   abtop-bridge populates. No structural change needed.
3. **Multi-machine fleet.** Swap SQLite → libsql/Turso, add a thin sync
   layer; the API contract is unchanged.
4. **Outcome auto-detection.** Instead of asking the operator,
   classifier on the diff + commit message + test results to infer
   accepted/partial/rejected. Replaces the manual outcome prompt.
5. **Cost-shaping policies.** "Stay under $X today" as a hard rule that
   re-scores providers in real time. The rule chain already supports it.
6. **Persona evolution.** Personas with usage history get prompt-template
   refinements suggested by an offline job mining `frontdesk_decision`
   accepts. UI surface: "evolve this persona" button on the rail.
7. **Web-tab terminal share.** A read-only WS topic per session so a
   second tab/device can spectate a long-running agent.
8. **Plug-in skills.** Skills become npm packages with manifests; the
   skill catalog scans node_modules at boot. Already implicit — just
   formalize.

---

## 15 · Open architectural calls

Decisions that should be made before implementation, with the
recommendation in **bold**:

1. **PTY in-process or sidecar?**
   `node-pty` works for one operator; Rust `pty-hub` is overengineering
   for v2. **Recommendation:** start with `node-pty` in `ao-core`.
   Promote to sidecar only if you observe rendering glitches with claude
   interactive UI or hangs under high IO.

2. **Frontdesk LLM provider?**
   Anthropic Haiku 4.5 with prompt caching is the cheapest cacheable
   option that meets latency. **Recommendation:** Haiku 4.5 default,
   with a `frontdesk.llm.provider` knob so it can swap to a local
   model when `privacyMode = strict`.

3. **abtop-bridge JSON-RPC or stdout-tail?**
   Cleanest is a `--rpc` mode emitting framed JSON over a UNIX socket.
   **Recommendation:** add `--rpc` to abtop. Falling back to TUI parsing
   is fragile and makes abtop's UI a coupling boundary.

4. **Should the savings pill show live local-vs-cloud breakdown?**
   The richer view (§9.2) is more honest but more cognitive load.
   **Recommendation:** show the headline number; expose the breakdown
   on hover.

5. **How aggressive is auto-attach (rule #1)?**
   If a `debug · agent-office` session is already live, do we *force*
   attach or just propose it? **Recommendation:** propose loudly (the
   pre-fill button changes to "Attach to session 5fac46de"), but let
   the operator override.

---

## Appendix A — End-to-end launch trace

The whole life of one launch, target state:

```
1. user types task in command bar
2. UI POST /api/frontdesk/route { task }
3. frontdesk.runRules(state, task) → Candidates
4. frontdesk.runLLM(Candidates, task) → Proposal      [haiku, ~400ms cached]
5. ao-core writes to frontdesk_decision (input only)
6. UI receives Proposal, pre-fills wizard combos
7. user reviews; toggles a history item off
8. user clicks Launch
9. UI POST /api/launch { persona, project, history, skills, provider }
10. launcher builds prompt, computes baseline+optimized
11. launcher inserts history_session row (status=launching)
12. launcher inserts launch_budget row
13. launcher requests pty-hub spawn (or node-pty)
14. provider hook fires AGENT_OFFICE_HISTORY_SESSION_ID env var
15. session starts; ws-bus emits session:start
16. abtop-bridge picks up the new pid; starts emitting LiveSamples
17. UI live-ops rail shows the new card
18. operator interacts in xterm pane (WS pty:io)
19. operator closes terminal
20. provider hook fires post-session, POSTs /api/history/ingest
21. ao-core upserts summary + observations
22. UI prompts outcome; operator clicks "accepted"
23. ao-core updates launch_budget.outcome, frontdesk_decision.outcome
24. savings-ledger rolls up; ws-bus emits savings:tick
25. UI savings pill ticks up
```

Every arrow is observable in WS topics or log lines. Every persisted
piece is in one of three tables: `history_*`, `launch_budget`,
`frontdesk_decision`. There is no hidden state.
