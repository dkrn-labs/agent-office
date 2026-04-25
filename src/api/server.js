import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
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
import { savingsRoutes } from './routes/savings.js';
import { frontdeskRoutes } from './routes/frontdesk.js';
import { ptyRoutes } from './routes/pty.js';
import { quotaRoutes } from './routes/quota.js';
import { createPtyHost } from '../pty/node-pty-host.js';
import { createProjectSyncService } from '../projects/project-sync.js';

/**
 * Creates and configures the Fastify application.
 *
 * Returns the Fastify instance. Callers obtain the underlying http.Server via
 * `app.server` after calling `await app.ready()`.
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
 * @returns {import('fastify').FastifyInstance & { locals: object }}
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
  const app = Fastify({ logger: false });

  // Test/back-compat shim — code (and tests) read `app.locals.launcher` etc.
  // Kept as a plain object so callers can mutate it like Express's locals.
  app.locals = {};

  const memoryEngine = createMemoryEngine(repo);
  const briefEnabled = process.env.AGENT_OFFICE_BRIEF_ENABLED !== '0';
  const briefBudget = Number(process.env.AGENT_OFFICE_BRIEF_BUDGET) || 1000;
  const projectHistory = createProjectHistoryStore(repo, {
    db,
    brief: { enabled: briefEnabled, budgetTokens: briefBudget },
  });

  try {
    const { drained } = repo.drainStuckHistorySessions({ ageHours: 1 });
    if (drained > 0) {
      console.log(`[server] drained ${drained} stuck in-progress history sessions`);
    }
  } catch (err) {
    console.warn('[server] drainStuckHistorySessions failed:', err.message);
  }
  if (briefEnabled) {
    console.log(`[server] persona brief enabled (budget=${briefBudget} tokens)`);
  }
  const localSkillInventory = scanLocalSkills(config.skillRoots);
  const resolver = createSkillResolver(repo, { localSkillInventory });

  const claudeMem = createClaudeMemAdapter(defaultClaudeMemPath());
  if (claudeMem) {
    console.log('[server] claude-mem adapter connected');
  }

  function registerUnattendedSession({ providerId, providerSessionId, projectPath, lastActivity }) {
    if (!providerId || !providerSessionId || !projectPath) return null;
    const project = repo.getProjectByPath(projectPath);
    if (!project) return null;
    const startedAt = lastActivity ?? new Date().toISOString();
    const { historySessionId } = projectHistory.createLaunch({
      projectId: project.id,
      personaId: null,
      providerId,
      providerSessionId,
      startedAt,
      status: 'in-progress',
      source: 'telemetry-watcher',
    });
    if (!historySessionId) return null;
    return { sessionId: historySessionId, projectId: project.id, personaId: null, startedAt };
  }

  const watcher = telemetry
    ? createCompositeWatcher([
        createJsonlWatcher({
          rootPath: telemetryRoot,
          idleMs: telemetryIdleMs,
          expiryMs: telemetryExpiryMs,
          createUnattended: registerUnattendedSession,
        }),
        createCodexWatcher({
          idleMs: telemetryIdleMs,
          expiryMs: telemetryExpiryMs,
          createUnattended: registerUnattendedSession,
        }),
        createGeminiWatcher({
          idleMs: telemetryIdleMs,
          expiryMs: telemetryExpiryMs,
          createUnattended: registerUnattendedSession,
        }),
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
  const portfolioStats = createPortfolioStatsService({ repo, projectsDir: config.projectsDir });
  const projectSync = createProjectSyncService({ repo, projectsDir: config.projectsDir });

  const mirrorMetrics = (providerId, providerSessionId, historySessionId, fields) => {
    let targetId = historySessionId ?? null;
    if (!targetId) {
      targetId = repo.findHistorySessionIdByProvider(providerId, providerSessionId);
    }
    if (!targetId) return;
    repo.upsertHistorySessionMetrics(targetId, fields);
  };

  watcher?.on('session:update', (payload) => {
    const costUsd = computeCostUsd({
      model: payload.lastModel,
      tokensIn: payload.totals.tokensIn,
      tokensOut: payload.totals.tokensOut,
      cacheRead: payload.totals.cacheRead,
      cacheWrite: payload.totals.cacheWrite,
    });

    const detail = projectHistory.getDetail(payload.sessionId);
    mirrorMetrics(detail?.providerId ?? payload.providerId ?? null, payload.providerSessionId, payload.sessionId, {
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
    const detail = projectHistory.getDetail(payload.sessionId);
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
    const endedAt = new Date().toISOString();
    const detailBefore = projectHistory.getDetail(payload.sessionId);
    const startedAt = detailBefore?.startedAt ?? payload.startedAt ?? endedAt;
    const inferred = await inferOutcome({
      projectPath: payload.projectPath ?? detailBefore?.projectPath ?? null,
      startedAt,
      endedAt,
    });

    repo.updateHistorySession(payload.sessionId, { endedAt, status: 'completed' });
    repo.upsertHistorySessionMetrics(payload.sessionId, {
      commitsProduced: inferred.signals?.commitsProduced ?? null,
      diffExists: inferred.signals?.diffExists ?? null,
      outcome: inferred.outcome,
    });

    if (inferred.outcome && typeof repo.setLaunchBudgetOutcome === 'function') {
      try { repo.setLaunchBudgetOutcome(payload.sessionId, inferred.outcome); } catch {}
    }

    const detail = detailBefore ? projectHistory.getDetail(payload.sessionId) : null;
    const resolvedProviderId = detail?.providerId ?? payload.providerId ?? null;
    const resolvedProviderSessionId = payload.providerSessionId ?? detail?.providerSessionId ?? null;
    mirrorMetrics(resolvedProviderId, resolvedProviderSessionId, payload.sessionId, {
      commitsProduced: inferred.signals?.commitsProduced ?? null,
      diffExists: inferred.signals?.diffExists ?? null,
      outcome: inferred.outcome,
    });

    bus.emit(SESSION_ENDED, {
      sessionId: payload.sessionId,
      providerId: resolvedProviderId,
      providerSessionId: resolvedProviderSessionId,
      personaId: detail?.personaId ?? null,
      projectId: detail?.projectId ?? null,
      projectName: detail?.projectName ?? null,
      projectPath: detail?.projectPath ?? payload.projectPath ?? null,
      personaLabel: detail?.personaLabel ?? null,
      personaDomain: detail?.personaDomain ?? null,
      startedAt,
      endedAt,
      outcome: inferred.outcome,
      commitsProduced: inferred.signals?.commitsProduced ?? null,
      diffExists: inferred.signals?.diffExists ?? null,
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

  if (telemetry && startTelemetryWatcher) watcher?.start();
  if (telemetry) aggregator.start();

  app.locals.launcher = launcher;
  app.locals.telemetry = { watcher, aggregator };
  app.locals.stopTelemetry = () => {
    aggregator.stop();
    watcher?.stop();
    claudeMem?.close?.();
  };

  const ptyHost = createPtyHost();
  app.locals.ptyHost = ptyHost;

  // Register all route plugins. Order doesn't matter functionally for Fastify
  // but matches the previous Express mount order for diff reviewers.
  app.register(healthRoutes());
  app.register(projectRoutes(repo, db, projectSync));
  app.register(portfolioRoutes(portfolioStats));
  app.register(configRoutes(configDir));
  app.register(personaRoutes(repo, db));
  app.register(skillRoutes(repo, resolver));
  app.register(officeRoutes(launcher, { ptyHost }));
  app.register(sessionRoutes({ repo, watcher, aggregator }));
  app.register(memoryRoutes(memoryEngine, repo, importFromClaudeProjects, db));
  app.register(historyRoutes(projectHistory, { repo }));
  app.register(savingsRoutes({ repo }), { prefix: '/api/savings' });
  app.register(ptyRoutes({ ptyHost }), { prefix: '/api/pty' });
  app.register(quotaRoutes());
  app.register(frontdeskRoutes({
    repo,
    getActiveSessions: () => watcher?.snapshot?.() ?? [],
    getQuotaForProvider: async () => null,
    getPrefs: () => ({ privacyMode: 'normal' }),
    getSignals: () => ({}),
  }), { prefix: '/api/frontdesk/route' });

  // Static file serving for production builds. In dev, Vite proxies instead.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.join(__dirname, '../../ui/dist');
  if (fs.existsSync(distPath)) {
    app.register(fastifyStatic, { root: distPath, prefix: '/' });
    // SPA fallback: any non-API GET that didn't match falls through here.
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
