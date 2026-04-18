# Agent Office

A local-first workspace where your AI coding agents live in a pixel-art office — and actually remember what they did.

Instead of a chat list, you get:

- a pixel-art office where each desk maps to a specialist persona (frontend, backend, debug, ops, review, docs…)
- a launch flow with project selection, provider/model choice, and prompt preview
- live session telemetry across Claude Code, Codex, and Gemini CLI — visible, not invisible
- **persona-scoped memory** that gets pre-loaded at session start so agents don't re-learn your project every turn
- portfolio stats and history so you can see what your agents actually did

Built for solo developer workflows, not a hosted SaaS.

---

## Why it's different

### 1. You can watch your AI work

Three rooms (the Boss, the Workspace, the Dungeon), a dozen personas, a Fixer who roams the floor. When a session goes live, the relevant persona walks from the Dungeon to the Workspace and sits at a desk. It's not decoration — it's a legible operator view. You see at a glance who is working on what.

### 2. Unified memory across providers

One memory store per project. Observations captured from Claude Code, Codex, Gemini CLI, and Ollama flow into the same `history_observation` table. Switch providers mid-task without losing context. Memory lives in a local SQLite DB on your disk — you own your data, it doesn't leave your machine.

### 3. Lower token bill per session

Sessions don't inject raw memory. They inject a **persona-scoped brief** — a compact markdown rollup of the most recent and most semantically relevant observations for this persona on this project. Less context per turn → lower bill, faster answers.

End-to-end measurement on a real Claude Code task shows **~35% lower cost per session** and **~44% faster wall-time** vs injecting the full raw memory, with no loss of answer quality. Benchmarks below.

### 4. Runs local, on the subscription you already have

No cloud account. No new license. Uses whichever provider CLIs you already have installed (`claude`, `codex`, `gemini`) — plus Ollama for local, offline models. Your subscriptions. Your machine. Your files.

---

## Benchmarks

Measured on this machine, 141 real observations across three anonymised projects of different sizes.

### Micro-benchmark — token counts at the injection point

How much smaller is the brief than dumping all memory? Project IDs anonymised.

| Project | Observations | Raw tokens | Brief tokens | Savings |
| --- | ---: | ---: | ---: | ---: |
| A (large)  | 107 | 5,333 | 768 | **85.6%** |
| B (medium) |  29 | 1,161 | 644 | 44.5% |
| C (small)  |   7 |   144 | 156 | –8.3% |
| **Total**  | **141** | **6,638** | **1,568** | **76.4%** |

Savings scale with memory size. Sub-10-observation projects don't benefit — brief overhead exceeds the raw memory it's trying to compress. At ~30 observations you're saving ~45%. Past 100, you're consistently above 80%.

Reproduce:

```bash
node scripts/benchmark-brief.mjs --budget 1000
```

### End-to-end — real Claude Code session, real billing

Same task prompt ("Summarise what I shipped this week and what's still in progress"), three variants, via `claude -p`:

| Variant | Input cost | Turns | Elapsed | Answer quality |
| --- | ---: | ---: | ---: | --- |
| no-context | $0.2103 | 4 | 46 s | Decent from git log; misses uncommitted work |
| raw-memory | $0.3118 | 3 | 82 s | Most detailed; cites memory IDs |
| **brief**  | **$0.2022** | **2** | **46 s** | **On par with raw; tighter and cheaper** |

The brief beat raw memory by:

- **35% lower cost per session** ($0.20 vs $0.31)
- **44% faster wall-time** (46 s vs 82 s)
- **one fewer turn** (2 vs 3)
- **comparable answer quality** — full transcripts under `bench/e2e/runs/`

Single task, one project, one model. Not a production claim. Wider validation in progress.

Reproduce:

```bash
node scripts/export-bench-contexts.mjs <project-name>
echo "your task prompt" > bench/e2e/task.md
bash scripts/bench-e2e.sh
```

---

## Requirements

- Node.js 22+
- macOS is the primary supported environment
- One or more local provider CLIs if you want to launch agents:
  - `claude`, `codex`, `gemini`
- Optional: Ollama running locally, if you want offline embeddings or local models

The office UI can run without every provider installed; launch paths and telemetry fidelity will vary.

## Install

```bash
git clone git@github.com:dkrn-labs/agent-office.git
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

Run frontend and backend together:

```bash
npm run startup:dev      # backend :3334 + Vite :5173
```

Or separately:

```bash
AGENT_OFFICE_PORT=3334 npm run dev           # backend with watch
AGENT_OFFICE_BACKEND_PORT=3334 npm run dev:ui # UI only
```

Full test suite:

```bash
npm test
```

## Memory brief commands

```bash
# Backfill embeddings for existing observations (first time).
node scripts/backfill-embeddings.mjs

# Measure brief savings on your local data.
node scripts/benchmark-brief.mjs --budget 1000

# Dump a brief for a project so you can read/tune it.
node scripts/benchmark-brief.mjs --budget 1000 --dump-briefs bench/briefs
```

## Architecture

- **Backend**: Node/Express for launch orchestration, telemetry ingestion, persistence, and APIs.
- **Frontend**: React + Vite for the pixel-art office and dashboard surfaces.
- **Storage**: single SQLite DB under `~/.agent-office/`. Memory, sessions, portfolio stats, all local. WAL + foreign keys. [`sqlite-vec`](https://github.com/asg017/sqlite-vec) handles vector search.
- **Embeddings**: `@huggingface/transformers` running all-MiniLM-L6-v2 locally (384-dim, offline after first download). Ollama is a drop-in alternative via the same provider interface.
- **Telemetry**: ingested from each provider's native state (Claude Code JSONL, Codex local SQLite, Gemini session JSON).

Key directories:

```
src/agents/         personas, launcher, skill resolver, provider catalog
src/api/            office / sessions / portfolio / config / skills / memory routes
src/db/             migrations + repository; migration 005 adds vec_observation
src/memory/         claude-mem adapter, persona filter, and:
  brief/            persona-scoped brief generator (embeddings + selector)
src/telemetry/      Claude / Codex / Gemini ingestion + session tracking
ui/src/office/      pixel-art office, engine, sprites, launch interactions
ui/src/dashboard/   history + telemetry views
scripts/            one-off utilities (benchmark, backfill, layout builder, capture)
```

## CLI

```bash
agent-office init --projects-dir ~/Projects   # create local data dir
agent-office start                            # run the server
agent-office doctor                           # readiness check
```

## Limitations

- Telemetry fidelity is provider-specific.
- Provider usage limits are not implemented yet.
- Setup is still developer-oriented; no published npm distribution yet.
- Benchmarks above use one task prompt on one repo — treat them as directional, not guaranteed.
- Asset provenance needs continued hardening if you plan to redistribute.

## What this is not

- Not a cloud service.
- Not multi-user.
- Not production deployment infrastructure.
- Not a replacement for your provider CLIs.
- Not yet a polished consumer product.

## Third-party provenance

This project builds on external work and assets:

- The office engine in `ui/src/office/` was adapted in part from [`pixel-agents`](https://github.com/pablodelucca/pixel-agents).
- The pixel-art office uses third-party art assets in `ui/public/assets`.

See [`docs/ATTRIBUTION.md`](docs/ATTRIBUTION.md) and [`ui/public/assets/PROVENANCE.md`](ui/public/assets/PROVENANCE.md) for details.

## Licensing

The code in this repository is MIT-licensed. Third-party engine ideas and art assets may carry different terms. Treat the office art as hobby/demo assets unless you have independently verified redistribution rights for your use case.

## Why I built it

I wanted a local workspace where multiple coding agents feel like a visible team instead of invisible terminal tabs. The office metaphor isn't decoration — it's a way to make launch decisions, live state, and recent output legible at a glance. The memory layer is the quiet thing that keeps them useful turn after turn.
