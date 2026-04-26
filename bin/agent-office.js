#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { createCommand } from 'commander';
import { openDatabase, runMigrations } from '../src/db/database.js';
import { createRepository } from '../src/db/repository.js';
import { getDefault, loadConfig, saveConfig } from '../src/core/config.js';
import { loadSettings } from '../src/core/settings.js';
import { createEventBus } from '../src/core/event-bus.js';
import { createApp } from '../src/api/server.js';
import { createWsHub } from '../src/api/ws-hub.js';
import { discoverCapabilities } from '../src/providers/capability-registry.js';
import { listAdapters } from '../src/providers/manifest.js';
import { installHooksForAdapters } from '../src/providers/install-hooks-on-boot.js';
import { createLmStudioBridge } from '../src/providers/lmstudio-bridge.js';
import { createLogger } from '../src/core/logger.js';
import { scanDirectory } from '../src/skills/project-scanner.js';
import { createPersonaRegistry } from '../src/agents/persona-registry.js';
import { seedBuiltInSkills } from '../src/agents/built-in-skills.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const log = createLogger('cli');

const program = createCommand();

function parseNodeMajor(version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  return Number.isFinite(major) ? major : 0;
}

function commandOnPath(command) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], { encoding: 'utf8' });
  return result.status === 0;
}

program
  .name('agent-office')
  .description('A local developer tool that gives you a team of AI coding agents')
  .version(version);

// ── init ──────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize agent-office in a data directory')
  .option('--data-dir <path>', 'data directory', join(os.homedir(), '.agent-office'))
  .option('--projects-dir <path>', 'directory to scan for projects (overrides config default)')
  .action(async (opts) => {
    const dataDir = resolve(opts.dataDir);

    // 1. Create data dir
    mkdirSync(dataDir, { recursive: true });
    log.info('Created data directory', { dataDir });

    // 2. Write default config (with projectsDir override if provided)
    const config = getDefault();
    if (opts.projectsDir) {
      config.projectsDir = resolve(opts.projectsDir);
    }
    saveConfig(config, dataDir);
    log.info('Wrote config.json', { projectsDir: config.projectsDir });

    // 3. Open DB and run migrations
    const dbPath = join(dataDir, 'agent-office.db');
    const db = openDatabase(dbPath);
    await runMigrations(db);
    log.info('Database ready', { dbPath });

    // 4. Scan projects dir and create project rows
    const repo = createRepository(db);
    const projects = scanDirectory(config.projectsDir);
    let created = 0;
    for (const p of projects) {
      try {
        repo.createProject({
          path: p.path,
          name: p.name,
          techStack: p.techStack,
          stackHash: p.stackHash,
        });
        created++;
      } catch (err) {
        // Skip duplicates or other non-fatal errors
        log.warn('Skipped project', { name: p.name, reason: err.message });
      }
    }
    log.info('Scanned projects', { found: projects.length, created });

    // 5. Seed built-in personas
    const personaRegistry = createPersonaRegistry(repo);
    await personaRegistry.seedBuiltIns();
    const personaCount = repo.listPersonas().length;
    log.info('Seeded built-in personas', { count: personaCount });

    // 6. Seed built-in skills
    const { inserted: skillsInserted } = await seedBuiltInSkills(repo);
    log.info('Seeded built-in skills', { inserted: skillsInserted });

    // 7. Seed 2 default garden rules
    const rules = [
      {
        scope: 'global',
        schedule: '0 2 * * 0', // weekly Sunday 2am
        strategy: 'memory_garden',
        config: { maxTokens: 200000 },
      },
      {
        scope: 'global',
        schedule: '0 3 * * 0', // weekly Sunday 3am
        strategy: 'claude_md_update',
        config: { maxTokens: 100000 },
      },
    ];

    for (const rule of rules) {
      repo.createGardenRule(rule);
    }
    log.info('Seeded garden rules', { count: rules.length });

    // 8. Close DB
    db.close();

    // 9. Print summary
    console.log(`\nagent-office initialized successfully`);
    console.log(`  data dir:     ${dataDir}`);
    console.log(`  database:     ${dbPath}`);
    console.log(`  projects dir: ${config.projectsDir}`);
    console.log(`  projects:     ${created} imported`);
    console.log(`  personas:     ${personaCount} seeded`);
    console.log(`  skills:       ${skillsInserted} seeded`);
    console.log(`  garden rules: ${rules.length} seeded`);
    console.log(`\nRun 'agent-office start' to launch the server.`);
  });

// ── start ─────────────────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the agent-office server')
  .option('--data-dir <path>', 'data directory', join(os.homedir(), '.agent-office'))
  .option('--port <number>', 'HTTP port (overrides config)', (v) => parseInt(v, 10))
  .option('--dry-run', 'skip iTerm spawn (useful for testing)', false)
  .action(async (opts) => {
    const dataDir = resolve(opts.dataDir);
    const configPath = join(dataDir, 'config.json');

    // Check config exists (error if not initialized)
    if (!existsSync(configPath)) {
      console.error(`Error: ${configPath} not found. Run 'agent-office init' first.`);
      process.exit(1);
    }

    // Load config + settings. CLI flag wins over settings.json which wins
    // over config.json which wins over the hard default.
    const config = loadConfig(dataDir);
    const settings = loadSettings(dataDir);
    const port = opts.port ?? settings.core?.port ?? config.port ?? 3333;

    // Open DB and run migrations
    const dbPath = join(dataDir, 'agent-office.db');
    const db = openDatabase(dbPath);
    await runMigrations(db);
    log.info('Database ready', { dbPath });

    // Create repo and event bus
    const repo = createRepository(db);
    const bus = createEventBus();

    // P2 Task 11 — discover provider capabilities (CLI presence + curated
    // strengths) before booting the app so the frontdesk prompt builder
    // can read a single merged snapshot. <100ms; no network.
    const packageDir = resolve(new URL('..', import.meta.url).pathname);
    let providerCapabilities = null;
    try {
      providerCapabilities = await discoverCapabilities({ dataDir, packageDir });
    } catch (err) {
      log.warn('Provider capability discovery failed; proceeding with empty registry', { error: err.message });
    }

    // P3-4 — install per-provider post-session hooks at boot. Idempotent;
    // each adapter's installHook returns { changed: false, reason: 'already
    // installed' } on repeat runs. Failures are logged, not thrown — a
    // missing CLI shouldn't crash boot.
    try {
      await installHooksForAdapters(listAdapters(), { log });
    } catch (err) {
      log.warn('Hook install pass failed', { error: err.message });
    }

    // P3-7 — local-backend health probe for R7. Only constructed when
    // aider-local is enabled; the bridge caches healthy results for 5s
    // so the probe is essentially free on every routing call.
    let getLocalBackendHealthy;
    const aiderEnabled = settings.providers?.['aider-local']?.enabled === true;
    if (aiderEnabled) {
      const host = settings.providers['aider-local'].lmstudioHost ?? 'http://localhost:1234';
      const bridge = createLmStudioBridge({ host, cacheMs: 5000 });
      getLocalBackendHealthy = async () => (await bridge.healthCheck()).ok === true;
    }

    // Create Fastify app
    const app = createApp({
      repo,
      bus,
      config,
      configDir: dataDir,
      db,
      dryRun: opts.dryRun ?? false,
      telemetry: true,
      settings,
      providerCapabilities,
      getLocalBackendHealthy,
    });

    // Wait for plugins to register so app.server has Fastify's request
    // listener attached, then bolt the WS hub onto the same http.Server.
    await app.ready();
    const server = app.server;
    createWsHub(server, bus, { ptyHost: app.locals.ptyHost });

    // Listen on the underlying http.Server directly. Using app.listen()
    // would also work but app.server.listen keeps the WS upgrade handler
    // wiring symmetric with how it was set up.
    await new Promise((res, rej) => {
      server.listen(port, '127.0.0.1', (err) => {
        if (err) return rej(err);
        res();
      });
    });

    log.info('Server started', { port, dataDir });
    console.log(`agent-office running on http://127.0.0.1:${port}`);

    // Graceful shutdown — idempotent, with a hard-exit fallback in case
    // keep-alive connections block server.close(). A second signal >500ms
    // after the first forces exit.
    let shutdownStartedAt = 0;
    const shutdown = (signal) => {
      const now = Date.now();
      if (shutdownStartedAt > 0) {
        if (now - shutdownStartedAt > 500) {
          log.info('Force exit', { signal });
          process.exit(1);
        }
        return;
      }
      shutdownStartedAt = now;
      log.info('Shutting down...', { signal });
      app.locals.stopTelemetry?.();
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      const hardExit = setTimeout(() => {
        log.warn('Shutdown timeout — forcing exit');
        process.exit(1);
      }, 3000);
      hardExit.unref();
      app.close().then(() => {
        clearTimeout(hardExit);
        try { db.close(); } catch (err) { log.warn('db.close failed', { err: err.message }); }
        log.info('Shutdown complete');
        process.exit(0);
      }).catch((err) => {
        clearTimeout(hardExit);
        log.warn('app.close failed', { err: err.message });
        process.exit(1);
      });
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });

// ── doctor ───────────────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Check whether this machine is ready to run agent-office')
  .option('--data-dir <path>', 'data directory', join(os.homedir(), '.agent-office'))
  .action((opts) => {
    const dataDir = resolve(opts.dataDir);
    const configPath = join(dataDir, 'config.json');
    const dbPath = join(dataDir, 'agent-office.db');
    const uiDistPath = join(resolve(join(import.meta.dirname, '..')), 'ui', 'dist', 'index.html');
    const configExists = existsSync(configPath);
    const dbExists = existsSync(dbPath);
    const uiBuilt = existsSync(uiDistPath);
    const nodeMajor = parseNodeMajor();
    const nodeOk = nodeMajor >= 22;

    const checks = [
      ['Node.js >= 22', nodeOk, process.versions.node],
      ['Config initialized', configExists, configPath],
      ['Database present', dbExists, dbPath],
      ['UI build present', uiBuilt, uiDistPath],
      ['Claude CLI on PATH', commandOnPath('claude'), 'claude'],
      ['Codex CLI on PATH', commandOnPath('codex'), 'codex'],
      ['Gemini CLI on PATH', commandOnPath('gemini'), 'gemini'],
    ];

    console.log('agent-office doctor\n');
    for (const [label, ok, detail] of checks) {
      console.log(`${ok ? 'OK ' : 'NO '} ${label}${detail ? ` — ${detail}` : ''}`);
    }

    console.log('');
    if (!configExists) {
      console.log(`Next step: run 'agent-office init --projects-dir ~/Projects'`);
    } else if (!uiBuilt) {
      console.log(`Next step: run 'npm run build:ui'`);
    } else {
      console.log(`Next step: run 'agent-office start'`);
    }

    process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
  });

// ── garden ────────────────────────────────────────────────────────────────────

program
  .command('garden')
  .description('Run the memory garden (not yet implemented)')
  .action(() => {
    console.log('not yet implemented');
  });

// ── providers ────────────────────────────────────────────────────────────────

const providers = program.command('providers').description('Inspect/refresh provider capability registry');

providers
  .command('list')
  .description('Show installed CLIs and configured models from the capability registry')
  .action(async () => {
    const dataDir = process.env.AGENT_OFFICE_HOME ?? join(os.homedir(), '.agent-office');
    const packageDir = resolve(new URL('..', import.meta.url).pathname);
    const caps = await discoverCapabilities({ dataDir, packageDir });

    // For aider-local, an LMStudio reachability dot beats the static
    // "installed" CLI check — Aider being on PATH doesn't tell you whether
    // the local backend is up.
    const settingsPath = join(dataDir, 'settings.json');
    let lmHost = 'http://localhost:1234';
    let aiderEnabled = false;
    try {
      const s = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const a = s.providers?.['aider-local'];
      if (a?.enabled === true) aiderEnabled = true;
      if (a?.lmstudioHost) lmHost = a.lmstudioHost;
    } catch { /* settings.json optional */ }
    let aiderHealth = null;
    if (aiderEnabled) {
      const bridge = createLmStudioBridge({ host: lmHost });
      aiderHealth = await bridge.healthCheck().catch((err) => ({ ok: false, reason: err?.message ?? String(err) }));
    }

    for (const [id, p] of Object.entries(caps.providers ?? {})) {
      let status = p.installed
        ? `[32m✓ installed[0m (${p.installedVersion ?? 'unknown version'})`
        : `[2m· not installed[0m`;
      if (id === 'aider-local') {
        if (!aiderEnabled) status += ' · disabled in settings';
        else if (aiderHealth?.ok) status += ' · LMStudio reachable';
        else status += ` · LMStudio unreachable: ${aiderHealth?.reason ?? '?'}`;
      }
      console.log(`${p.label.padEnd(34)} [${p.kind}]  ${status}`);
      for (const m of p.models ?? []) {
        const mark = m.default ? '★' : ' ';
        console.log(`  ${mark} ${m.id}  ${m.costTier ?? ''}`);
      }
    }
    console.log(`\nlast verified: ${caps.lastVerifiedAt ?? 'unknown'}`);
  });

providers
  .command('refresh')
  .description('Refresh provider strengths/models from upstream docs (TODO — manual edit for now)')
  .action(() => {
    const dataDir = process.env.AGENT_OFFICE_HOME ?? join(os.homedir(), '.agent-office');
    const userPath = join(dataDir, 'provider-capabilities.json');
    console.log('Provider capability auto-refresh is not yet implemented (P5).');
    console.log('To update strengths/models in the meantime, edit:');
    console.log(`  ${userPath}`);
    console.log('and bump `lastVerifiedAt` to today. Restart agent-office to');
    console.log('pick up the changes.');
  });

program.parseAsync(process.argv);
