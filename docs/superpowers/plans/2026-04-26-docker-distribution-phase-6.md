# Docker distribution + onboarding web UI — Phase 6 (P6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`
> to walk this plan task-by-task. Steps use `- [ ]` checkboxes for tracking.
>
> **Test discipline:** during the TDD inner loop run `npm run test:unit`
> (sub-second). Only run `npm run test:integration` at task-exit. The
> Docker image build itself is verified with smoke commands, not
> automated tests — see "How we verify" below.

**Goal.** A new user does this and is up and running:

```bash
git clone https://github.com/dkrn-labs/agent-office.git
cd agent-office
docker compose up
# open http://localhost:3334
```

The container ships everything: `claude`, `codex`, `gemini`, `aider`,
`abtop`, ao-core (Node + Fastify), the dashboard UI. On first launch
the dashboard redirects to `/onboarding`, a step-by-step wizard that
walks through:

1. **Authenticate to each provider** — the wizard runs each CLI's
   auth flow in a managed PTY, surfaces the auth URL, the user clicks
   through in their browser, the callback completes inside the
   container.
2. **Configure LMStudio** (optional) — point at host's `host.docker.internal:1234`
   if the user wants the local routing path.
3. **Pick the projects directory** — bind-mount target. Default is
   `~/Projects` on the host, mounted at `/projects` in the container.
4. **Doctor pass** — confirm everything resolved.

After onboarding, the user lands in the regular dashboard. State
persists in named volumes — `docker compose down && up` keeps auth.

**Trigger.** P5 polish + the 20-task acceptance benchmark have shipped
or are close enough that we're confident in the routing quality.
Distribution becomes the bottleneck.

**Architecture references.**
- `docs/architecture/agent-commander.md` (the host-side architecture
  this plan packages).
- `docs/superpowers/plans/2026-04-26-multi-provider-phase-3.md` —
  defines the adapter contract that makes "all CLIs in one image"
  tractable.
- `docs/superpowers/plans/2026-04-26-abtop-bridge-and-image-paste-phase-4.md`
  — abtop runs in-container under this plan; reads in-container
  processes (which is exactly what we want, since the agents also live
  in-container).
- README "Free to use" section — public-distribution framing.

**Tech stack.** Docker (multi-stage build) · docker-compose v2 · GitHub
Actions for multi-arch (`amd64` + `arm64`) image build · GHCR for
hosting · existing Fastify + React stack inside the image.

**Out of scope.**
- Multi-user / SaaS hosting. The container is single-tenant; one user
  per running container.
- Authoring a Helm chart, k8s manifests, or systemd units.
- Replacing the current "git clone + npm install" dev path. That
  stays — the Docker image is additive distribution.
- Auto-updates. `docker compose pull` is the upgrade path; no
  in-app self-updater.
- Windows-native containers. Docker Desktop on Windows + WSL2 should
  work but isn't a primary target; Linux/macOS first.

---

## File Structure

**Create:**
- `Dockerfile` — multi-stage. Stages:
  1. `base` — Debian slim + Node 22 + Python 3.11 + Rust toolchain (builder only).
  2. `cli-builder` — installs claude-code, codex, gemini, aider, abtop into a staging dir.
  3. `ui-builder` — `npm install && npm run build` against `ui/`.
  4. `runtime` — Debian slim + Node 22 + Python runtime + ps/lsof + the
     three sets of artifacts copied from prior stages. Non-root `agent`
     user. Entrypoint runs `agent-office start`.
- `.dockerignore` — excludes `node_modules`, `ui/dist` (rebuilt
  in-image), `~/.agent-office` (mounted, not baked), `*.log`.
- `docker-compose.yml` — single service `agent-office`. Named volumes
  for `~/.agent-office` (DB, briefs, paste images) and `~/.claude`,
  `~/.codex`, `~/.gemini` (auth state). Bind-mount for the user's
  projects directory. Port mapping `3334:3334`. `host.docker.internal`
  add-host for Linux parity. Env vars for LMStudio host override.
- `compose.override.yml.example` — template for users who want to
  override the projects-dir mount or expose extra ports.
- `src/api/routes/onboarding.js` — backend endpoints:
  - `GET /api/onboarding/status` returns per-provider auth state
    (logged in vs. needs login) + LMStudio reachability.
  - `POST /api/onboarding/auth/start` — body `{ providerId }`. Spawns
    the CLI's auth command in a managed PTY, parses stdout for the auth
    URL, returns `{ url, ptyId }` (the PTY stays alive so the wizard
    can stream output for visibility).
  - `POST /api/onboarding/auth/abort` — kills the PTY.
  - `POST /api/onboarding/projects-dir` — sets the projects-dir choice
    in `~/.agent-office/config.json`.
- `ui/src/onboarding/OnboardingWizard.jsx` — stepper component.
- `ui/src/onboarding/steps/Welcome.jsx`,
  `AuthProvider.jsx`,
  `Lmstudio.jsx`,
  `ProjectsDir.jsx`,
  `DoctorPass.jsx` — one component per step.
- `test/api/onboarding.test.js` (integration) — pins the endpoint
  shape using mocked CLI auth flows.
- `.github/workflows/docker.yml` — multi-arch build via `docker buildx`,
  push to `ghcr.io/dkrn-labs/agent-office:{latest,vX.Y.Z}`.
- `docs/distribution/docker.md` — user-facing quickstart, mounted vs
  named-volume reference, troubleshooting (port conflicts,
  `host.docker.internal` on Linux, LMStudio over the host bridge).

**Modify:**
- `src/api/server.js` — at boot, when `~/.agent-office/onboarding.complete`
  is missing, the SPA fallback for non-API GETs serves the onboarding
  bundle. After completion the file is written; subsequent boots go
  straight to the dashboard.
- `bin/agent-office.js` — `agent-office doctor` already covers most of
  the wizard's final check; surface its JSON shape (`--json` flag) so
  the wizard can call it programmatically.
- `src/core/settings.js` — add `onboarding.projectsDir` (the
  user's chosen mount target inside the container, defaults to
  `/projects`).
- `README.md` — add a "Run with Docker" section ahead of the existing
  "Install" instructions; the dev install stays for contributors.

**Delete:** Nothing.

---

## Tasks

### Track A — image build

#### A1 — Multi-stage Dockerfile (no UI yet)
- [ ] Write the four stages described above. The `runtime` stage
  must boot ao-core via `node bin/agent-office.js start --port 3334`
  on `0.0.0.0`. Bind to all interfaces inside the container; rely on
  Docker's port mapping for host-side access.
- [ ] Install matrix:
  - `claude` — `npm install -g @anthropic-ai/claude-code` (verify
    package name at build time; pin to a known-good version).
  - `codex` — pre-built tarball from upstream releases (avoids
    bringing in the Rust toolchain at runtime). Pin version.
  - `gemini` — `npm install -g @google/gemini-cli`. Pin version.
  - `aider` — `pip install aider-chat` in a venv under `/opt/aider`,
    add to PATH. Pin version.
  - `abtop` — pre-built release tarball. Pin version.
- [ ] Final image runs as non-root `agent` user with `~ = /home/agent`.
  All auth state lives under `/home/agent/.{claude,codex,gemini}`
  and `/home/agent/.agent-office`.
- [ ] **Verify (smoke):**
  ```bash
  docker build -t ao:dev .
  docker run --rm ao:dev claude --version
  docker run --rm ao:dev codex --version
  docker run --rm ao:dev gemini --version
  docker run --rm ao:dev aider --version
  docker run --rm ao:dev abtop --once
  ```

#### A2 — Bake the UI into the runtime stage
- [ ] `ui-builder` stage runs `npm ci && npm run build` against `ui/`,
  emits `dist/`. Runtime stage `COPY --from=ui-builder /work/ui/dist
  /app/ui/dist`.
- [ ] **Verify:** `docker run --rm -p 3334:3334 ao:dev` → curl
  `http://localhost:3334/` returns the bundled HTML.

#### A3 — `docker-compose.yml` with sensible defaults
- [ ] Single service. Named volumes:
  - `agent-office-data` → `/home/agent/.agent-office`
  - `agent-office-claude` → `/home/agent/.claude`
  - `agent-office-codex` → `/home/agent/.codex`
  - `agent-office-gemini` → `/home/agent/.gemini`
- [ ] Bind-mount: `${PROJECTS_DIR:-$HOME/Projects}:/projects` (read-
  write — agents edit files). Document in the README that a `.env`
  file with `PROJECTS_DIR=...` overrides.
- [ ] Port: `3334:3334`.
- [ ] `extra_hosts: ["host.docker.internal:host-gateway"]` for Linux
  parity (no-op on Mac/Win where Docker Desktop sets it up natively).
- [ ] `environment: AGENT_OFFICE_LMSTUDIO_HOST=http://host.docker.internal:1234`
  passed through to the runtime — overrideable in `.env`.
- [ ] **Verify:**
  ```bash
  docker compose up
  open http://localhost:3334    # redirects to /onboarding
  ```

#### A4 — GitHub Actions multi-arch build
- [ ] `.github/workflows/docker.yml` triggers on tags `v*` and on
  pushes to `main` (latter pushes `:edge`, not `:latest`). Builds
  `linux/amd64` + `linux/arm64` with `docker buildx`, pushes to
  GHCR.
- [ ] Sign images with `cosign --yes` (keyless OIDC against GHCR).
- [ ] **Verify:** push a `vX.Y.Z` tag; confirm both architectures
  end up at `ghcr.io/dkrn-labs/agent-office`.

### Track B — onboarding backend

#### B1 — `GET /api/onboarding/status`
- [ ] Probe per-provider login state by file presence and a dry CLI
  call (e.g. `claude --print "noop"` succeeds when authed). Cache
  results 5s.
- [ ] Probe LMStudio reachability via the existing `lmstudio-bridge.healthCheck`.
- [ ] Probe projects-dir presence + writability.
- [ ] Return shape: `{ providers: { 'claude-code': { authed: bool,
  lastChecked: iso }, ... }, lmstudio: { reachable: bool, host: string },
  projectsDir: { path: string, ok: bool }, complete: bool }`.
- [ ] **Test (integration):** mock the file system + bridge. Pin the
  shape and the cache-window behavior.

#### B2 — `POST /api/onboarding/auth/start`
- [ ] Accept `{ providerId }`. Per-provider command map (e.g.
  claude-code → `claude /login`, codex → `codex login`,
  gemini-cli → `gemini`).
- [ ] Spawn under `node-pty`, attach to the existing PTY hub so the
  wizard's xterm.js panel can show the live output. Stream stdout via
  ws-bus topic `onboarding:auth:line`.
- [ ] Watch stdout for the auth URL (each CLI prints a different
  line; ship a per-provider regex). On match, return `{ url, ptyId }`.
  The PTY stays alive — closing it via abort or letting auth complete
  is the user's choice.
- [ ] **Test (integration):** mock `node-pty` with a fake stream that
  prints a fixture URL. Assert the URL is parsed and returned.

#### B3 — `POST /api/onboarding/auth/abort`
- [ ] Kills the PTY, marks the in-flight attempt aborted.
- [ ] **Test:** straightforward.

#### B4 — `POST /api/onboarding/projects-dir`
- [ ] Validates the path exists, is a directory, is writable. Persists
  to `~/.agent-office/config.json` under `projectsDir`.
- [ ] Returns the same shape as `GET /api/onboarding/status`.
- [ ] **Test (integration):** temp dir setup + assert the config file
  changes.

#### B5 — Onboarding-complete sentinel
- [ ] When all providers in the user's chosen subset are authed AND
  the projects-dir is set AND the doctor pass is green, write
  `~/.agent-office/onboarding.complete` (just an ISO timestamp).
- [ ] `src/api/server.js` SPA fallback checks this file: missing →
  serve `/onboarding/index.html` for any non-API GET. Present →
  serve the regular `index.html`.
- [ ] **Test (integration):** integration test that boots the app,
  verifies the redirect, writes the sentinel, verifies the redirect
  goes away.

### Track C — onboarding frontend

#### C1 — Stepper shell
- [ ] `OnboardingWizard.jsx` — top-level. State in a Zustand store
  to keep the per-step component code dumb. Steps:
  Welcome → ClaudeAuth → CodexAuth → GeminiAuth → LMStudio (skippable)
  → ProjectsDir → DoctorPass → Done.
- [ ] Each step: a centered card with a primary CTA. Skip-for-now
  link on the optional steps. Persistent left rail shows step
  progress.
- [ ] On mount, calls `GET /api/onboarding/status` to fast-forward
  past already-completed steps (so re-running the wizard after a
  partial setup picks up where the user left off).

#### C2 — `AuthProvider` step component
- [ ] Calls `POST /api/onboarding/auth/start` with the relevant
  `providerId`. Receives `{ url, ptyId }`. Shows a big "Open this
  link to sign in" button that does `window.open(url, '_blank',
  'noopener')`.
- [ ] Streams the PTY output via the existing WS PTY route into a
  tiny embedded xterm.js panel — read-only, just for visibility.
- [ ] Polls `GET /api/onboarding/status` every 2s after the user
  clicks. When `providers[id].authed` flips true, advances to the
  next step.
- [ ] Cancel button → `POST /api/onboarding/auth/abort`.

#### C3 — `LMStudio`, `ProjectsDir`, `DoctorPass` steps
- [ ] LMStudio: shows the default `host.docker.internal:1234`, with a
  health-probe button. Skip if the user doesn't want local routing.
- [ ] ProjectsDir: a path input pre-filled with `/projects` (the
  default mount). Validates via the backend. Surfaces the docker-
  compose hint about `PROJECTS_DIR=...` in `.env`.
- [ ] DoctorPass: calls `agent-office doctor --json` (B-side
  enhancement) and renders the per-check result.

#### C4 — First-launch redirect logic
- [ ] In `App.jsx`: on mount, if `GET /api/onboarding/status`
  returns `complete: false`, navigate to `/onboarding`. After
  completion, the SPA falls through to the dashboard normally.

### Track D — distribution polish

#### D1 — README + docs/distribution/docker.md
- [ ] Top of README: a 5-line "Run with Docker" section pointing
  to the compose file. Existing dev-install instructions follow.
- [ ] `docs/distribution/docker.md`:
  - port conflicts (`PORT=3335 docker compose up`)
  - LMStudio over the host bridge (Linux's `host.docker.internal`
    requirement)
  - clearing auth state (`docker volume rm agent-office-claude`)
  - upgrading (`docker compose pull && docker compose up`)
  - resource recommendations (image is ~1–1.5 GB; needs ~2 GB free
    RAM for ao-core itself, separate from any local model)

#### D2 — Image-size discipline
- [ ] Run `dive ghcr.io/dkrn-labs/agent-office:edge` after the
  first build. Confirm the image is under 1.5 GB. If it's larger,
  see what's inflating — typical culprits: leaked node_modules,
  Rust toolchain bleeding into runtime, pip cache.
- [ ] Add a CI check that fails the build when the runtime image
  exceeds 2 GB (hard ceiling).

---

## Acceptance (P6 exit checklist)

A first-time user, on a fresh laptop with only Docker Desktop installed,
runs:

```bash
git clone https://github.com/dkrn-labs/agent-office.git
cd agent-office
docker compose up
```

…and within ~5 minutes is launching their first agent session. More
specifically:

- [ ] **Image builds** locally and on CI for both `linux/amd64` and
  `linux/arm64` (Track A).
- [ ] **Image size ≤ 1.5 GB** for `:latest`; ≤ 2 GB hard cap (D2).
- [ ] **`docker compose up` brings up a working dashboard** at
  `http://localhost:3334` (A3).
- [ ] **First-launch redirect** lands the user at `/onboarding`
  (B5 sentinel, C4 redirect).
- [ ] **All four CLIs auth via the wizard** end-to-end:
  claude-code, codex, gemini-cli (aider doesn't need auth, but the
  wizard surfaces "ready" status). User clicks the auth URL, the
  callback completes inside the container, the wizard advances.
- [ ] **Auth state survives** `docker compose down && docker compose up`
  via named volumes (A3).
- [ ] **abtop runs in-container** and the dashboard's live ops rail
  shows real CTX% bars on a launched session (validated against the
  P4-A6 timeline pattern).
- [ ] **LMStudio bridge reaches the host** via
  `host.docker.internal:1234` from inside the container, on Mac and
  on Linux with the `extra_hosts` line.
- [ ] **README + docs/distribution/docker.md** cover the quickstart,
  troubleshooting, and upgrade paths.

---

## Risks / open questions

- **Auth-URL parsing is brittle.** Each CLI prints its auth URL in a
  different format, and those formats can change between minor
  versions. Mitigations:
  1. Pin CLI versions in the Dockerfile so a vendor change doesn't
     break the wizard out from under us.
  2. Per-provider regexes live in one config file
     (`src/api/onboarding/auth-urls.js`), easy to update.
  3. When the regex misses, surface the live PTY output so the user
     can copy the URL manually as a fallback. The wizard never strands
     the user.
- **CLI version drift.** When we bump claude-code from 2.1.x to 2.2.x,
  the auth flow might shift. Track CLI versions in the
  `provider-capabilities.default.json` registry and surface "wizard
  tested against vX.Y.Z" in the auth step UI so a user with a newer
  CLI knows to file an issue if something breaks.
- **OAuth callback host mismatch.** Most CLIs callback to
  `http://localhost:<random-port>`. From the user's host browser,
  `localhost` resolves to the host, and the CLI is listening inside
  the container. Two paths:
  1. The CLI prints the port; we map it through `docker-compose`'s
     dynamic-port range. Awkward but possible.
  2. Prefer device-flow auth where it's available — user enters a
     code, no callback needed. Cleaner.
  3. Some CLIs accept `--callback-url <override>` — use that to point
     at a known mapped port.
  Mitigation: document the actual mechanism per CLI in
  `docs/distribution/docker.md` once we've tested each.
- **Image bloat.** Claude Code's npm package alone is ~200 MB,
  Aider+Python ~250 MB, abtop binary ~30 MB, Node 22 + glibc base
  ~150 MB, ao-core + UI ~50 MB. Plus the Rust toolchain leaking from
  the cli-builder stage if we're not careful. Discipline matters in
  the multi-stage layout.
- **arm64 binary availability.** Pre-built abtop releases must include
  arm64. If they don't, we either fall back to building from source
  (adds Rust toolchain to that arch's image) or skip arm64 — not
  acceptable for M-series Mac users. Verify upstream release
  matrix during A1.
- **Projects-dir UX on Mac**. Docker Desktop's file-sharing across
  bind-mounts has historically been slow. Document that, and consider
  defaulting to `:cached` consistency for the bind-mount.
- **Privileged operations.** abtop uses `ps`/`lsof` against the
  container's PID namespace — no privilege escalation needed when the
  agents are also in the container. Confirms the all-in-container
  decision was the right one for this phase.
- **CLI updates inside the running image.** When the user runs `claude`
  inside the container and Anthropic ships a new version, the CLI
  may try to self-update. We should pin in a way that doesn't fight
  that, or set the env var per-CLI that disables auto-update if one
  exists. Document explicit "to upgrade, `docker compose pull`" so
  users know the canonical path.

## How we verify

- **Per-task smoke commands** are listed in each task. Image builds
  + `docker run` invocations check the slice the task added.
- **Onboarding flow** is verified end-to-end manually on a clean Mac
  (`rm -rf ~/Library/Containers/com.docker.docker/Data/vms/0/data` is
  the nuclear "fresh laptop" approximation) and on a clean Ubuntu
  VM. Document those steps in `docs/distribution/docker.md` so
  future contributors can re-run the acceptance check.
- **Backend onboarding tests** under `test/api/onboarding.test.js`
  pin the endpoint shapes against mocked PTY streams. They don't
  invoke the real CLI — that part is covered by the manual smoke.

## What this is not

- Not a hosted SaaS. Single-tenant container, one user per running
  instance.
- Not a Helm chart. `docker compose` is the supported orchestration.
- Not a path to multi-user. Auth state is per-container; sharing
  `~/.claude` across containers is a foot-gun and explicitly
  unsupported.
- Not removing the dev install. `git clone + npm install` stays as
  the contributor path.
