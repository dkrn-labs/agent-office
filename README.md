# Agent Office

`agent-office` is a local-first workspace for running multiple AI coding agents across your real projects.

Instead of a chat list, it gives you:
- a pixel-art office where each desk maps to a persona
- a launch flow with project selection, provider/model choice, and prompt preview
- live session telemetry for Claude Code, Codex, and Gemini CLI
- history and portfolio stats so you can see what your agents actually did

This is a hobby project built for solo developer workflows, not a hosted SaaS product.

## Value proposition

Most agent tooling is good at generating text and bad at making ongoing work legible.

Agent Office focuses on the operator view:
- launch the right agent into the right repo quickly
- inspect the exact prompt before the session starts
- see which project, provider, model, and token volume are active
- keep multiple coding agents visible without treating them like invisible background jobs

## Current capabilities

- Local project scan and active project inventory
- Persona-based launch flow
- Prompt preview with resolved skills, installed skills, and project context
- Provider selection:
  - Claude Code
  - Codex
  - Gemini CLI
- Live telemetry ingestion:
  - Claude Code JSONL
  - Codex local sqlite state
  - Gemini local session JSON
- Session history, outcome inference, and recent-session views
- Portfolio stats across local git repos and session history

## What this is not

- Not a cloud service
- Not multi-user
- Not production deployment infrastructure
- Not a replacement for your provider CLIs
- Not yet a polished npm-distributed consumer product

## Requirements

- Node.js 22+
- macOS is the primary supported environment today
- One or more local provider CLIs installed if you want to launch agents:
  - `claude`
  - `codex`
  - `gemini`

The office UI can still run without every provider installed, but launch paths and telemetry fidelity will vary.

## Quick start

Clone the repo and install dependencies:

```bash
git clone <your-repo-url>
cd agent-office
npm install
cd ui
npm install
cd ..
```

Initialize the local data directory:

```bash
node bin/agent-office.js init --projects-dir ~/Projects
```

Optional readiness check:

```bash
npm run doctor
```

Build the UI once:

```bash
npm run build:ui
```

Start the app:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:3333
```

## Development

Backend with file watching:

```bash
npm run dev
```

UI dev server:

```bash
cd ui
npm run dev
```

## CLI

Initialize local state:

```bash
agent-office init --projects-dir ~/Projects
```

Start the server:

```bash
agent-office start
```

Current placeholder command:

```bash
agent-office garden
```

## Architecture

High level:
- Node/Express backend for launch orchestration, telemetry, persistence, and APIs
- React/Vite frontend for the office UI and dashboard surfaces
- SQLite for local state
- Local filesystem and provider-native state files as telemetry sources

Important subsystems:
- `src/agents/` for personas, launch orchestration, provider catalog, and skill resolution
- `src/telemetry/` for Claude/Codex/Gemini ingestion and session tracking
- `src/api/` for office, sessions, portfolio, config, skills, and memory routes
- `ui/src/office/` for the pixel-art office and launch interactions
- `ui/src/dashboard/` for history and operational telemetry views

## Third-party provenance

This project builds directly on external work and assets.

- The office engine in `ui/src/office/` was adapted in part from `pixel-agents`, including extraction/adaptation of engine structure and related modules from that upstream project:
  - <https://github.com/pablodelucca/pixel-agents>
- The pixel-art office also uses third-party art assets shipped in `ui/public/assets`.

See [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md) for the current provenance and licensing notes.
There is also an asset-local provenance record in [ui/public/assets/PROVENANCE.md](ui/public/assets/PROVENANCE.md).

## Important licensing note

The code in this repository is MIT-licensed.

Third-party engine ideas and art assets may have different licenses and restrictions. In particular, treat the included office art as hobby/demo assets unless you have independently verified their provenance and redistribution terms for your use case.

If you plan to commercialize or broadly redistribute a derivative, audit and replace third-party assets as needed.

## Limitations

- Telemetry fidelity is provider-specific
- Provider usage limits are not implemented yet
- Setup is still developer-oriented
- Public packaging is in progress
- Asset provenance needs continued hardening for broader redistribution

## Why I built it

I wanted a local workspace where multiple coding agents feel like a visible team instead of invisible terminal tabs.

The office metaphor is not just decoration. It is a way to make launch decisions, live state, and recent output understandable at a glance.
