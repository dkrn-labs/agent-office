import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';
import { portfolioRoutes } from './routes/portfolio.js';
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
import { createCodexWatcher } from '../telemetry/codex-watcher.js';
import { createGeminiWatcher } from '../telemetry/gemini-watcher.js';
import { createCompositeWatcher } from '../telemetry/composite-watcher.js';
import { createAggregator } from '../telemetry/session-aggregator.js';
import { computeCostUsd } from '../telemetry/pricing.js';
import { inferOutcome } from '../telemetry/outcome-inference.js';
import { sessionRoutes } from './routes/sessions.js';
import { SESSION_ENDED, SESSION_IDLE, SESSION_UPDATE } from '../core/events.js';
import { scanLocalSkills } from '../skills/local-skill-index.js';
import { createPortfolioStatsService } from '../stats/portfolio-stats.js';
import { createProjectHistoryStore } from '../history/project-history.js';
import { historyRoutes } from './routes/history.js';

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
 *   telemetryExpiryMs?: number,
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
  telemetryExpiryMs,
  startTelemetryWatcher = true,
}) {
  const app = express();

  app.use(express.json());

  // Skill resolver uses repo.listSkills() — pass repo as the "db" argument
  // (createSkillResolver's param is named db but only calls .listSkills())
  const memoryEngine = createMemoryEngine(repo);
  const briefEnabled = process.env.AGENT_OFFICE_BRIEF_ENABLED !== '0';
  const briefBudget = Number(process.env.AGENT_OFFICE_BRIEF_BUDGET) || 1000;
  const projectHistory = createProjectHistoryStore(repo, {
    db,
    brief: { enabled: briefEnabled, budgetTokens: briefBudget },
  });
  if (briefEnabled) {
    console.log(`[server] persona brief enabled (budget=${briefBudget} tokens)`);
  }
  const localSkillInventory = scanLocalSkills(config.skillRoots);
  const resolver = createSkillResolver(repo, { localSkillInventory });

  const claudeMem = createClaudeMemAdapter(defaultClaudeMemPath());
  if (claudeMem) {
    console.log('[server] claude-mem adapter connected');
  }

  const watcher = telemetry
    ? createCompositeWatcher([
        createJsonlWatcher({
          rootPath: telemetryRoot,
          idleMs: telemetryIdleMs,
          expiryMs: telemetryExpiryMs,
        }),
        createCodexWatcher({ idleMs: telemetryIdleMs, expiryMs: telemetryExpiryMs }),
        createGeminiWatcher({ idleMs: telemetryIdleMs, expiryMs: telemetryExpiryMs }),
      ])
    : null;
  const launcher = createLauncher({
    repo,
    bus,
    resolver,
    dryRun,
    memoryEngine,
    projectHistory,
    watcher,
    skillRoots: config.skillRoots,
  });
  const aggregator = createAggregator({ repo, claudeMem, bus, watcher });
  const portfolioStats = createPortfolioStatsService({
    repo,
    projectsDir: config.projectsDir,
  });

  const mirrorMetrics = (providerId, providerSessionId, legacySessionId, fields) => {
    let historySessionId = repo.findHistorySessionIdByProvider(providerId, providerSessionId);
    if (!historySessionId && legacySessionId != null) {
      const legacy = repo.getSession(Number(legacySessionId));
      if (legacy) {
        historySessionId = repo.findLauncherHistorySessionId({
          projectId: legacy.projectId,
          personaId: legacy.personaId,
          startedAt: legacy.startedAt,
        });
        if (historySessionId && providerSessionId) {
          repo.updateHistorySession(historySessionId, { providerSessionId });
        }
      }
    }
    if (!historySessionId) return;
    repo.upsertHistorySessionMetrics(historySessionId, fields);
  };

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

    const detail = repo.getSessionDetail(payload.sessionId);
    mirrorMetrics(detail?.providerId ?? null, payload.providerSessionId, payload.sessionId, {
      tokensIn: payload.totals.tokensIn,
      tokensOut: payload.totals.tokensOut,
      tokensCacheRead: payload.totals.cacheRead,
      tokensCacheWrite: payload.totals.cacheWrite,
      costUsd,
      lastModel: payload.lastModel,
    });

    bus.emit(SESSION_UPDATE, {
      sessionId: payload.sessionId,
      providerSessionId: payload.providerSessionId,
      providerId: detail?.providerId ?? null,
      personaId: payload.personaId ?? detail?.personaId ?? null,
      projectId: payload.projectId ?? detail?.projectId ?? null,
      startedAt: detail?.startedAt ?? null,
      lastActivity: payload.lastActivity,
      lastModel: payload.lastModel,
      projectName: detail?.projectName ?? null,
      projectPath: detail?.projectPath ?? payload.projectPath ?? null,
      personaLabel: detail?.personaLabel ?? null,
      personaDomain: detail?.personaDomain ?? null,
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
    const detail = repo.getSessionDetail(payload.sessionId);
    bus.emit(SESSION_IDLE, {
      ...payload,
      providerId: detail?.providerId ?? null,
      startedAt: detail?.startedAt ?? null,
      projectName: detail?.projectName ?? null,
      projectPath: detail?.projectPath ?? payload.projectPath ?? null,
      personaLabel: detail?.personaLabel ?? null,
      personaDomain: detail?.personaDomain ?? null,
      lastModel: detail?.lastModel ?? null,
      totals: {
        tokensIn: detail?.tokensIn ?? 0,
        tokensOut: detail?.tokensOut ?? 0,
        cacheRead: detail?.tokensCacheRead ?? 0,
        cacheWrite: detail?.tokensCacheWrite ?? 0,
        total: detail?.totalTokens ?? 0,
        costUsd: detail?.costUsd ?? null,
      },
    });
  });

  watcher?.on('session:expired', async (payload) => {
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
    mirrorMetrics(
      detail?.providerId ?? null,
      payload.providerSessionId ?? detail?.providerSessionId ?? null,
      payload.sessionId,
      {
        commitsProduced: inferred.signals?.commitsProduced ?? null,
        diffExists: inferred.signals?.diffExists ?? null,
        outcome: inferred.outcome,
      },
    );
    bus.emit(SESSION_ENDED, {
      sessionId: payload.sessionId,
      providerSessionId: payload.providerSessionId,
      providerId: detail?.providerId ?? null,
      personaId: payload.personaId,
      projectId: payload.projectId,
      startedAt: detail?.startedAt ?? null,
      personaLabel: detail?.personaLabel ?? null,
      personaDomain: detail?.personaDomain ?? null,
      projectName: detail?.projectName ?? null,
      projectPath: detail?.projectPath ?? payload.projectPath ?? null,
      lastModel: detail?.lastModel ?? null,
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
  app.use(projectRoutes(repo, db));
  app.use(portfolioRoutes(portfolioStats));
  app.use(configRoutes(configDir));
  app.use(personaRoutes(repo, db));
  app.use(skillRoutes(repo, resolver));
  app.use(officeRoutes(launcher));
  app.use(sessionRoutes({ repo, watcher, aggregator }));
  app.use(memoryRoutes(memoryEngine, repo, importFromClaudeProjects, db));
  app.use(historyRoutes(projectHistory, { repo }));

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
