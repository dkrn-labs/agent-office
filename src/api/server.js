import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';
import { configRoutes } from './routes/config.js';
import { personaRoutes } from './routes/personas.js';
import { skillRoutes } from './routes/skills.js';
import { officeRoutes } from './routes/office.js';
import { createSkillResolver } from '../agents/skill-resolver.js';
import { createLauncher } from '../agents/launcher.js';
import { createMemoryEngine } from '../memory/memory-engine.js';
import { importFromClaudeProjects } from '../memory/claude-importer.js';
import { memoryRoutes } from './routes/memories.js';
import { createClaudeMemAdapter, defaultClaudeMemPath } from '../memory/claude-mem-adapter.js';
import { createJsonlWatcher } from '../telemetry/jsonl-watcher.js';
import { createAggregator } from '../telemetry/session-aggregator.js';
import { computeCostUsd } from '../telemetry/pricing.js';
import { inferOutcome } from '../telemetry/outcome-inference.js';
import { sessionRoutes } from './routes/sessions.js';
import { SESSION_ENDED, SESSION_IDLE, SESSION_UPDATE } from '../core/events.js';

/**
 * Creates and configures the Express application.
 *
 * @param {{
 *   repo: ReturnType<import('../db/repository.js').createRepository>,
 *   bus: ReturnType<import('../core/event-bus.js').createEventBus>,
 *   config: object,
 *   configDir: string,
 *   db?: import('better-sqlite3').Database,
 *   dryRun?: boolean,
 *   telemetry?: boolean,
 *   telemetryRoot?: string,
 *   telemetryIdleMs?: number,
 *   startTelemetryWatcher?: boolean,
 * }} options
 * @returns {import('express').Application}
 */
export function createApp({
  repo,
  bus,
  config,
  configDir,
  db,
  dryRun = true,
  telemetry = false,
  telemetryRoot,
  telemetryIdleMs,
  startTelemetryWatcher = true,
}) {
  const app = express();

  app.use(express.json());

  // Skill resolver uses repo.listSkills() — pass repo as the "db" argument
  // (createSkillResolver's param is named db but only calls .listSkills())
  const resolver = createSkillResolver(repo);
  const memoryEngine = createMemoryEngine(repo);

  const claudeMem = createClaudeMemAdapter(defaultClaudeMemPath());
  if (claudeMem) {
    console.log('[server] claude-mem adapter connected');
  }

  const watcher = telemetry
    ? createJsonlWatcher({ rootPath: telemetryRoot, idleMs: telemetryIdleMs })
    : null;
  const launcher = createLauncher({
    repo,
    bus,
    resolver,
    dryRun,
    memoryEngine,
    claudeMem,
    watcher,
  });
  const aggregator = createAggregator({ repo, claudeMem, bus, watcher });

  watcher?.on('session:update', (payload) => {
    const costUsd = computeCostUsd({
      model: payload.lastModel,
      tokensIn: payload.totals.tokensIn,
      tokensOut: payload.totals.tokensOut,
      cacheRead: payload.totals.cacheRead,
      cacheWrite: payload.totals.cacheWrite,
    });

    repo.updateSession(payload.sessionId, {
      providerSessionId: payload.providerSessionId,
      lastModel: payload.lastModel,
      tokensIn: payload.totals.tokensIn,
      tokensOut: payload.totals.tokensOut,
      tokensCacheRead: payload.totals.cacheRead,
      tokensCacheWrite: payload.totals.cacheWrite,
      costUsd,
    });

    bus.emit(SESSION_UPDATE, {
      sessionId: payload.sessionId,
      providerSessionId: payload.providerSessionId,
      personaId: payload.personaId,
      projectId: payload.projectId,
      lastActivity: payload.lastActivity,
      lastModel: payload.lastModel,
      totals: {
        tokensIn: payload.totals.tokensIn,
        tokensOut: payload.totals.tokensOut,
        cacheRead: payload.totals.cacheRead,
        cacheWrite: payload.totals.cacheWrite,
        total: payload.totals.total,
        costUsd,
      },
    });
  });

  watcher?.on('session:idle', async (payload) => {
    bus.emit(SESSION_IDLE, payload);

    const session = repo.getSession(payload.sessionId);
    if (!session) return;
    const endedAt = new Date().toISOString();
    const inferred = await inferOutcome({
      projectPath: payload.projectPath,
      startedAt: session.startedAt ?? endedAt,
      endedAt,
    });

    repo.updateSession(payload.sessionId, {
      endedAt,
      commitsProduced: inferred.signals?.commitsProduced ?? null,
      diffExists: inferred.signals?.diffExists ?? null,
      outcome: inferred.outcome,
    });

    const detail = repo.getSessionDetail(payload.sessionId);
    bus.emit(SESSION_ENDED, {
      sessionId: payload.sessionId,
      providerSessionId: payload.providerSessionId,
      personaId: payload.personaId,
      projectId: payload.projectId,
      personaLabel: detail?.personaLabel ?? null,
      projectName: detail?.projectName ?? null,
      endedAt,
      durationSec: detail?.durationSec ?? null,
      totals: {
        tokensIn: detail?.tokensIn ?? 0,
        tokensOut: detail?.tokensOut ?? 0,
        cacheRead: detail?.tokensCacheRead ?? 0,
        cacheWrite: detail?.tokensCacheWrite ?? 0,
        total: detail?.totalTokens ?? 0,
        costUsd: detail?.costUsd ?? null,
      },
      outcome: inferred.outcome,
      outcomeSignals: inferred.signals,
    });
  });

  if (telemetry && startTelemetryWatcher) {
    watcher?.start();
  }
  if (telemetry) {
    aggregator.start();
  }
  app.locals.launcher = launcher;
  app.locals.telemetry = {
    watcher,
    aggregator,
  };
  app.locals.stopTelemetry = () => {
    aggregator.stop();
    watcher?.stop();
    claudeMem?.close?.();
  };

  // Mount route modules
  app.use(healthRoutes());
  app.use(projectRoutes(repo));
  app.use(configRoutes(configDir));
  app.use(personaRoutes(repo));
  app.use(skillRoutes(repo));
  app.use(officeRoutes(launcher));
  app.use(sessionRoutes({ repo, watcher, aggregator }));
  app.use(memoryRoutes(memoryEngine, repo, importFromClaudeProjects));

  // Static file serving for production builds.
  // In dev, Vite's dev server handles assets via proxy instead.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.join(__dirname, '../../ui/dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback: send index.html for any non-API route
    app.get('/{*path}', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}
