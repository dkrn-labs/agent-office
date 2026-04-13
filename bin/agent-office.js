#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import os from 'node:os';
import { createCommand } from 'commander';
import { openDatabase, runMigrations } from '../src/db/database.js';
import { createRepository } from '../src/db/repository.js';
import { getDefault, loadConfig, saveConfig } from '../src/core/config.js';
import { createEventBus } from '../src/core/event-bus.js';
import { createApp } from '../src/api/server.js';
import { createWsHub } from '../src/api/ws-hub.js';
import { createLogger } from '../src/core/logger.js';
import { scanDirectory } from '../src/skills/project-scanner.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const log = createLogger('cli');

const program = createCommand();

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

    // 5. Seed 2 default garden rules
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

    // 6. Close DB
    db.close();

    // 7. Print summary
    console.log(`\nagent-office initialized successfully`);
    console.log(`  data dir:     ${dataDir}`);
    console.log(`  database:     ${dbPath}`);
    console.log(`  projects dir: ${config.projectsDir}`);
    console.log(`  projects:     ${created} imported`);
    console.log(`  garden rules: ${rules.length} seeded`);
    console.log(`\nRun 'agent-office start' to launch the server.`);
  });

// ── start ─────────────────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the agent-office server')
  .option('--data-dir <path>', 'data directory', join(os.homedir(), '.agent-office'))
  .option('--port <number>', 'HTTP port (overrides config)', (v) => parseInt(v, 10))
  .action(async (opts) => {
    const dataDir = resolve(opts.dataDir);
    const configPath = join(dataDir, 'config.json');

    // Check config exists (error if not initialized)
    if (!existsSync(configPath)) {
      console.error(`Error: ${configPath} not found. Run 'agent-office init' first.`);
      process.exit(1);
    }

    // Load config
    const config = loadConfig(dataDir);
    const port = opts.port ?? config.port ?? 3333;

    // Open DB and run migrations
    const dbPath = join(dataDir, 'agent-office.db');
    const db = openDatabase(dbPath);
    await runMigrations(db);
    log.info('Database ready', { dbPath });

    // Create repo and event bus
    const repo = createRepository(db);
    const bus = createEventBus();

    // Create Express app
    const app = createApp({ repo, bus, config, configDir: dataDir });

    // Create HTTP server and attach WS hub
    const server = createServer(app);
    createWsHub(server, bus);

    // Listen
    await new Promise((res, rej) => {
      server.listen(port, '127.0.0.1', (err) => {
        if (err) return rej(err);
        res();
      });
    });

    log.info('Server started', { port, dataDir });
    console.log(`agent-office running on http://127.0.0.1:${port}`);

    // SIGINT handler: graceful shutdown
    process.on('SIGINT', () => {
      log.info('Shutting down...');
      server.close(() => {
        db.close();
        log.info('Shutdown complete');
        process.exit(0);
      });
    });
  });

// ── garden ────────────────────────────────────────────────────────────────────

program
  .command('garden')
  .description('Run the memory garden (not yet implemented)')
  .action(() => {
    console.log('not yet implemented');
  });

program.parseAsync(process.argv);
