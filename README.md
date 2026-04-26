# Agent Office

A local-first orchestrator for your AI coding agents. Routes each task to the right persona, the right provider, and the right model — using rules first and a small local LLM second — and remembers what every agent did.

Free to use. MIT-licensed code. No cloud account, no per-seat fees, no telemetry phoning home. Runs entirely on your machine against the provider CLIs you already have installed.

```
   you ──► task ──► frontdesk router ──► persona + provider + model
                       │
                       ├─ rules: privacy / cost / quota / verb-bias
                       └─ local LLM (Gemma 4 via LMStudio) — picks within candidates
```

---

## What it does

### 1. Multi-provider through a single contract

One adapter contract for every coding-agent CLI. Today: **Claude Code, Codex, Gemini CLI, and Aider** (local, via LMStudio). Adding another agent is one file. The launcher, savings ledger, frontdesk, and UI consume only the contract — no `if (provider === 'X')` branches.

### 2. Frontdesk router (rules + small LLM)

Every task goes through:

- **Stage 1 — deterministic rules** (16 of them). Privacy mode forces local. Daily $ cap forces local. Bug-verbs bias the Debug persona. Deploy-verbs restrict to DevOps. Token-quota over 95% drops the provider, 80–95% demotes it. Mechanical short tasks get tagged `oneshot`.
- **Stage 2 — local LLM picks within the candidates** the rules left behind. Gemma 4 E4B via LMStudio. ~6s p50 latency, $0/call, no API key, no quota burn. The Anthropic SDK path is opt-in for sub-second routing. Off by default — flip `frontdesk.llm.enabled` in settings.

Every decision is logged to `frontdesk_decision` so the learning loop (P5) can mine accepted picks.

### 3. Local-first cost shaping

When the rules say "must be local" — privacy strict, daily cap reached, secrets keywords in the task — the launcher routes to the **Aider-local adapter**, which spawns Aider against LMStudio's OpenAI-compatible endpoint. Cost = $0. The savings pill credits the cloud-equivalent ($/1k against Claude Sonnet) so the local routing shows up as money saved, not money missing.

### 4. Unified history, persona-scoped memory briefs

One memory store per project. Observations from every provider hook (Claude `Stop`, Gemini `AfterAgent`, Codex `notify`) flow into the same `history_observation` table. At launch time, sessions don't get the raw memory — they get a **persona-scoped brief**, a compact rollup of the most recent and most semantically relevant observations for *this* persona on *this* project.

End-to-end on a real Claude Code task:

| Variant | Input cost | Turns | Elapsed | Quality |
| --- | ---: | ---: | ---: | --- |
| no-context | $0.2103 | 4 | 46 s | misses uncommitted work |
| raw-memory | $0.3118 | 3 | 82 s | most detailed |
| **brief**  | **$0.2022** | **2** | **46 s** | on par with raw, tighter |

**~35% lower cost, ~44% faster, one fewer turn**, comparable quality. Single task, one project — directional, not guaranteed.

Reproduce: `node scripts/benchmark-brief.mjs --budget 1000`.

### 5. Live telemetry across providers

Per-provider watchers tail each CLI's native state — Claude JSONL, Codex SQLite, Gemini session JSON, Aider chat history. Sessions appear in the live ops rail with token counts, model in use, idle/expired transitions. No browser polling — WS bus events.

### 6. Two UIs

The default UI (`/`) is a clean dashboard layout: launch wizard, history, portfolio stats, live sessions, settings.

A pixel-art office view stays available at `/legacy` — desks mapped to personas, a Fixer who roams the floor, the persona walking from Dungeon to Workspace when their session goes live. It's not decoration: it's a legible operator view of who's working on what. (Adapted in part from [`pixel-agents`](https://github.com/pablodelucca/pixel-agents); see attribution below.)

---

## Requirements

- Node.js 22+
- macOS is the primary supported environment (Apple Silicon recommended for the local Gemma path)
- One or more provider CLIs: `claude`, `codex`, `gemini`, `aider` (any subset works)
- Optional but recommended for local routing: [LMStudio](https://lmstudio.ai/) with `google/gemma-4-e4b` loaded

The orchestrator runs without every provider; launch paths and telemetry fidelity scale to whatever you have installed. Run `agent-office providers list` to see what's wired up and whether the local backend is reachable.

## Install

```bash
git clone https://github.com/dkrn-labs/agent-office.git
cd agent-office
npm install && (cd ui && npm install)
```

Initialise the local data directory:

```bash
node bin/agent-office.js init --projects-dir ~/Projects
```

Optional readiness check:

```bash
npm run doctor
```

Build the UI once, start the backend:

```bash
npm run build:ui
npm start
```

Then open <http://127.0.0.1:3333>.

`npm run startup` does the full local bootstrap (init → build UI if stale → start backend).

## Development

```bash
npm run startup:dev      # backend :3334 + Vite :5173
npm test                 # full suite (unit + integration)
npm run test:unit        # sub-second TDD loop
```

## CLI

```bash
agent-office init --projects-dir ~/Projects   # create local data dir
agent-office start                            # run the server
agent-office doctor                           # readiness check
agent-office providers list                   # show installed CLIs + local backend health
agent-office providers refresh                # re-probe vendor capabilities
```

## Architecture

- **Backend**: Node 22 + Fastify for launch orchestration, telemetry ingestion, persistence, frontdesk router, and APIs.
- **Frontend**: React + Vite. Default dashboard at `/`, legacy pixel office at `/legacy`.
- **Storage**: single SQLite DB under `~/.agent-office/`. Memory, sessions, savings ledger, frontdesk decisions — all local. WAL + foreign keys. [`sqlite-vec`](https://github.com/asg017/sqlite-vec) handles vector search.
- **Embeddings**: `@huggingface/transformers` running all-MiniLM-L6-v2 locally (offline after first download).
- **Local LLM (frontdesk)**: LMStudio's OpenAI-compatible HTTP API. Anthropic SDK path is opt-in.
- **Telemetry**: per-provider watchers tail native state.

```
src/agents/         personas, launcher, skill resolver, preflight quota
src/providers/      adapter contract + claude-code/codex/gemini-cli/aider-local + lmstudio-bridge
src/frontdesk/      rules engine + LLM stage + decision log + prompt builder
src/api/            fastify routes (frontdesk, savings, sessions, history, providers, …)
src/db/             migrations + repository
src/memory/         memory store + persona-scoped brief generator
src/telemetry/      claude / codex / gemini / aider watchers + session aggregator
ui/src/             react app — layout/, dashboard/, office/ (legacy), term/
config/             provider-capabilities.default.json (vendor strengths registry)
docs/architecture/  spec docs (agent-commander.md, implementation-plan.md, benchmark-plan.md)
docs/superpowers/   per-phase implementation plans (P0–P3 done; P4–P5 pending)
```

## Limitations

- macOS-first. Linux mostly works; Windows requires WSL.
- Provider quota signals are stubbed (preflight `--rpc` bridge to abtop ships in P4). The 80/95% rules don't fire on real data yet.
- Aider's TUI under node-pty has occasional rendering glitches on heavy interactive turns; `pty-hub` Rust sidecar replaces node-pty in P4.
- Setup is developer-oriented; no published npm distribution yet.
- Benchmarks above use one task on one project — directional, not guaranteed.

## Roadmap / TODO

Implemented and stable: P0 (provider hooks), P1 (adapter contract + savings ledger + dashboard v2), P2 (frontdesk LLM stage + capability registry + fallback chains), P3 (multi-provider through contract + Aider-local + R7 enforcement + savings breakdown).

Next:

### P4 — abtop bridge + sidecar PTY
- [ ] Consume [`abtop`](https://github.com/graykode/abtop)'s `--rpc` JSON-RPC mode for live per-call telemetry (issue #0002 — preflight quota check).
- [ ] Drawer timeline panel driven by abtop's per-call data.
- [ ] `pty-hub` Rust sidecar (portable-pty + tokio + tungstenite) with replay buffer; falls back to node-pty.
- [ ] Launcher-side fallback recovery when a CLI hits its rate limit (codex → claude-code, etc. — already populated in `fallback_if_blocked`).

### P5 — polish & learning loop
- [ ] 5-shot block in the frontdesk prompt sampled from accepted decisions in the last 7 days.
- [ ] Persona-evolution offline job mining `frontdesk_decision` to suggest template tweaks.
- [ ] Outcome-prompt UI on session end (replaces auto-classification with operator click).
- [ ] `gh-bridge` for the project-activity ticker.
- [ ] Read-only session share at `/share/:id`.
- [ ] Build the 20-task acceptance benchmark harness and flip `frontdesk.llm.enabled = true` by default.
- [ ] Calibrate the claude-vs-codex tradeoff (Opus 87.6% SWE-bench Verified vs Codex's $$ tier).
- [ ] Observability: `/api/_health`, `/api/_metrics`, structured logs, log rotation.

Tracked in `docs/superpowers/plans/` (per-phase) and `docs/issues/` (open issues).

## Free to use

The code in this repository is MIT-licensed (see [`LICENSE`](./LICENSE)). You can use it personally or commercially, fork it, modify it, and ship products with it. There are no usage caps and no licensing fees from this project.

What you do still owe money for, when applicable:

- Cloud provider API/subscription fees (Anthropic, OpenAI, Google) when you launch sessions against their CLIs.
- Third-party art assets in `ui/public/assets` that ship with the legacy pixel office — those carry their own terms (see provenance below).

If you only run cloud sessions through your existing provider subscriptions and stay under their rate limits, agent-office adds no new bill.

## Attribution & third-party provenance

This project builds on or plans to integrate with several external projects. They are independent of agent-office:

- **[`abtop`](https://github.com/graykode/abtop)** — *planned, not yet integrated.* abtop is an MIT-licensed terminal monitor for AI coding agents (htop-style for Claude Code, Codex, etc.). Agent Office's P4 architecture intends to consume `abtop --rpc` over a UNIX socket for live per-call telemetry (token bars, port discovery, quota signals). No abtop code is currently shipped, linked, or required to run agent-office. Credit and thanks to [@graykode](https://github.com/graykode) for the upstream tool.
- **[`pixel-agents`](https://github.com/pablodelucca/pixel-agents)** — the legacy office engine in `ui/src/office/` was adapted in part from this project.
- **LimeZu "Modern tiles_Free"** — pixel-art assets in `ui/public/assets/{characters,floors,walls,furniture}` originate here. Treat them as hobby/demo assets unless you've independently verified redistribution rights for your use case.
- **[`sqlite-vec`](https://github.com/asg017/sqlite-vec)**, **`@huggingface/transformers`**, **Fastify**, **better-sqlite3**, **node-pty** — runtime dependencies; see `package.json` for license details.

See [`docs/ATTRIBUTION.md`](docs/ATTRIBUTION.md) and [`ui/public/assets/PROVENANCE.md`](ui/public/assets/PROVENANCE.md) for the full record.

## What this is not

- Not a cloud service.
- Not multi-user.
- Not production deployment infrastructure.
- Not a replacement for your provider CLIs — it orchestrates them.
- Not yet a polished consumer product. Setup is developer-oriented.

## Why I built it

Coding agents are powerful but invisible. They burn tokens and time on tasks the wrong agent should never have taken in the first place — Opus rewriting a one-line rename, Codex deploying when DevOps was sleeping, Gemini hallucinating a memory it never had. agent-office makes the routing decision visible and rule-driven, keeps the memory honest across providers, and credits local routing as actual savings instead of just "$0 spent." The team feels like a team, not a tab list.
