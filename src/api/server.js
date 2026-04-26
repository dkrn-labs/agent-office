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
import { SESSION_ENDED, SESSION_IDLE, SESSION_UPDATE, SAVINGS_TICK } from '../core/events.js';
import { scanLocalSkills } from '../skills/local-skill-index.js';
import { createPortfolioStatsService } from '../stats/portfolio-stats.js';
import { createProjectHistoryStore } from '../history/project-history.js';
import { historyRoutes } from './routes/history.js';
import { savingsRoutes } from './routes/savings.js';
import { frontdeskRoutes } from './routes/frontdesk.js';
import { createDecisionLog } from '../frontdesk/decision-log.js';
import { createRunLLM } from '../frontdesk/llm.js';
import { discoverCapabilities } from '../providers/capability-registry.js';
import { ptyRoutes } from './routes/pty.js';
import { quotaRoutes } from './routes/quota.js';
import { createPtyHost } from '../pty/node-pty-host.js';
import { createProjectSyncService } from '../projects/project-sync.js';
import { getDefaultSettings, enabledProviderIds } from '../core/settings.js';

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
  settings,
  frontdeskLLM,    // P2 — optional ({ state, task, candidates }) => { proposal, meta }
  providerCapabilities,   // P2 Task 11 — optional pre-discovered snapshot (tests inject)
  getLocalBackendHealthy, // P3-7 — optional async () => boolean for R7 routing decisions
}) {
  // Tests construct createApp without going through bin/agent-office.js
  // so they don't pass `settings`. Falling back to defaults keeps every
  // settings consumer below (frontdesk, savings cap, etc.) working.
  const effectiveSettings = settings ?? getDefaultSettings();
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
    const project = repo.resolveProjectByPath?.(projectPath) ?? repo.getProjectByPath(projectPath);
    if (!project) return null;
    // Idempotent: when the watcher rediscovers a JSONL/codex/gemini session
    // file across server restarts, the row already exists. Returning the
    // existing id keeps the caller's flow unchanged (and silences the
    // UNIQUE-constraint warning spam on boot).
    const existingId = repo.findHistorySessionIdByProvider(providerId, providerSessionId);
    if (existingId) {
      const detail = projectHistory.getDetail(existingId);
      return {
        sessionId: existingId,
        projectId: detail?.projectId ?? project.id,
        personaId: detail?.personaId ?? null,
        startedAt: detail?.startedAt ?? lastActivity ?? null,
      };
    }
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
    // Issue #0003 — historySessionId MUST be a real history_session.id.
    // Callers used to pass payload.sessionId (legacy) here; that path
    // violates the FK as soon as the two tables' sequences diverge.
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

    // Prefer the watcher-carried historySessionId (issue #0003); fall back
    // to provider-session lookup; never use payload.sessionId (legacy) as
    // a history_session.id.
    const detail = projectHistory.getDetail(payload.historySessionId ?? payload.sessionId);
    mirrorMetrics(detail?.providerId ?? payload.providerId ?? null, payload.providerSessionId, payload.historySessionId ?? null, {
      tokensIn: payload.totals.tokensIn,
      tokensOut: payload.totals.tokensOut,
      tokensCacheRead: payload.totals.cacheRead,
      tokensCacheWrite: payload.totals.cacheWrite,
      costUsd,
      lastModel: payload.lastModel,
    });

    // Mirror onto the legacy `session` row too so the v1 endpoints (e.g.
    // GET /api/sessions/:id) stay consistent with telemetry. This was
    // present in earlier commits and got dropped during the unified-history
    // refactor; restoring it is a no-op for v2 paths but fixes the v1
    // shim. Skipped when the watcher has no legacy sessionId.
    if (payload.sessionId != null) {
      try {
        repo.updateSession(payload.sessionId, {
          providerSessionId: payload.providerSessionId,
          lastModel: payload.lastModel,
          tokensIn: payload.totals.tokensIn,
          tokensOut: payload.totals.tokensOut,
          tokensCacheRead: payload.totals.cacheRead,
          tokensCacheWrite: payload.totals.cacheWrite,
          costUsd,
        });
      } catch (err) {
        // Stale legacy session id (e.g. unattended-only session never had
        // a legacy row) — fine, nothing to mirror.
      }
    }

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
    const detail = projectHistory.getDetail(payload.historySessionId ?? payload.sessionId);
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
    // Issue #0003 — prefer the watcher-carried historySessionId over the
    // legacy sessionId for every history_session-keyed write below.
    const historySessionId = payload.historySessionId
      ?? repo.findHistorySessionIdByProvider(payload.providerId ?? null, payload.providerSessionId ?? null)
      ?? null;
    const detailBefore = projectHistory.getDetail(historySessionId ?? payload.sessionId);
    const startedAt = detailBefore?.startedAt ?? payload.startedAt ?? endedAt;
    const inferred = await inferOutcome({
      projectPath: payload.projectPath ?? detailBefore?.projectPath ?? null,
      startedAt,
      endedAt,
    });

    if (historySessionId) {
      repo.updateHistorySession(historySessionId, { endedAt, status: 'completed' });
      repo.upsertHistorySessionMetrics(historySessionId, {
        commitsProduced: inferred.signals?.commitsProduced ?? null,
        diffExists: inferred.signals?.diffExists ?? null,
        outcome: inferred.outcome,
      });
    }

    // Mirror outcome/diff/commits onto the legacy session row so the
    // v1 GET /api/sessions/:id endpoint stays consistent (issue #0003).
    if (payload.sessionId != null) {
      try {
        repo.updateSession(payload.sessionId, {
          endedAt,
          commitsProduced: inferred.signals?.commitsProduced ?? null,
          diffExists: inferred.signals?.diffExists ?? null,
          outcome: inferred.outcome,
        });
      } catch {
        // Stale legacy session id — fine to skip.
      }
    }

    if (inferred.outcome && typeof repo.setLaunchBudgetOutcome === 'function' && historySessionId) {
      try {
        repo.setLaunchBudgetOutcome(historySessionId, inferred.outcome);
        // P1-10 — savings:tick lets the UI's savings pill refresh without
        // polling. Outcome flips can flip a row in/out of the rollup
        // (rejected is excluded), so this is the right moment to emit.
        bus.emit(SAVINGS_TICK, {
          reason: 'outcome-resolved',
          sessionId: payload.sessionId,
          historySessionId,
          outcome: inferred.outcome,
        });
      } catch {}
    }

    const detail = detailBefore && historySessionId ? projectHistory.getDetail(historySessionId) : null;
    const resolvedProviderId = detail?.providerId ?? payload.providerId ?? null;
    const resolvedProviderSessionId = payload.providerSessionId ?? detail?.providerSessionId ?? null;
    mirrorMetrics(resolvedProviderId, resolvedProviderSessionId, historySessionId, {
      commitsProduced: inferred.signals?.commitsProduced ?? null,
      diffExists: inferred.signals?.diffExists ?? null,
      outcome: inferred.outcome,
    });

    // The legacy `session` row carries the most recent telemetry totals
    // because the session:update handler mirrors there too. Pull from it
    // when projectHistory's detail doesn't have what the consumer needs.
    const legacyDetail = payload.sessionId != null
      ? repo.getSessionDetail(payload.sessionId)
      : null;

    bus.emit(SESSION_ENDED, {
      sessionId: payload.sessionId,
      historySessionId,
      providerId: resolvedProviderId,
      providerSessionId: resolvedProviderSessionId,
      personaId: detail?.personaId ?? legacyDetail?.personaId ?? null,
      projectId: detail?.projectId ?? legacyDetail?.projectId ?? null,
      projectName: detail?.projectName ?? legacyDetail?.projectName ?? null,
      projectPath: detail?.projectPath ?? legacyDetail?.projectPath ?? payload.projectPath ?? null,
      personaLabel: detail?.personaLabel ?? legacyDetail?.personaLabel ?? null,
      personaDomain: detail?.personaDomain ?? legacyDetail?.personaDomain ?? null,
      lastModel: detail?.lastModel ?? legacyDetail?.lastModel ?? null,
      startedAt,
      endedAt,
      outcome: inferred.outcome,
      commitsProduced: inferred.signals?.commitsProduced ?? null,
      diffExists: inferred.signals?.diffExists ?? null,
      totals: {
        tokensIn: detail?.tokensIn ?? legacyDetail?.tokensIn ?? 0,
        tokensOut: detail?.tokensOut ?? legacyDetail?.tokensOut ?? 0,
        cacheRead: detail?.tokensCacheRead ?? legacyDetail?.tokensCacheRead ?? 0,
        cacheWrite: detail?.tokensCacheWrite ?? legacyDetail?.tokensCacheWrite ?? 0,
        total: detail?.totalTokens ?? legacyDetail?.totalTokens ?? 0,
        costUsd: detail?.costUsd ?? legacyDetail?.costUsd ?? null,
      },
    });
  });

  if (telemetry && startTelemetryWatcher) watcher?.start();
  if (telemetry) aggregator.start();

  app.locals.launcher = launcher;
  app.locals.telemetry = { watcher, aggregator };
  app.locals.providerCapabilities = providerCapabilities ?? null;
  app.locals.stopTelemetry = () => {
    aggregator.stop();
    watcher?.stop();
    claudeMem?.close?.();
  };

  // P2 Task 11 — GET /api/providers returns the merged capability snapshot
  // so the UI (and the frontdesk prompt builder via runner state) can read
  // a single source of truth for vendor strengths and installed CLIs.
  app.get('/api/providers', async () => app.locals.providerCapabilities ?? { providers: {} });

  // P2 Task 12 — eager preload for LMStudio. The first frontdesk routing
  // call against a cold model loads ~10s on M-series; preloading here
  // turns it into a 1.3s warm-cache hit (per the 2026-04-26 experiment).
  // Three gates: enabled, transport=lmstudio, eagerPreload=true.
  // Failure is logged and swallowed — LMStudio not running is fine, the
  // route falls back to rules-only on first call.
  if (
    effectiveSettings.frontdesk?.llm?.enabled &&
    effectiveSettings.frontdesk?.llm?.transport === 'lmstudio' &&
    effectiveSettings.frontdesk?.llm?.eagerPreload !== false
  ) {
    setImmediate(() => {
      const lm = effectiveSettings.frontdesk.llm.lmstudio ?? {};
      const host = lm.host ?? 'http://localhost:1234';
      const model = lm.model ?? 'google/gemma-4-e4b';
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      fetch(`${host}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ok' }],
          max_tokens: 1,
          temperature: 0,
          // LMStudio respects keep_alive — keeps the KV cache hot for the
          // first real routing call.
          keep_alive: '15m',
        }),
        signal: controller.signal,
      }).then((r) => {
        if (!r.ok) {
          console.warn(`[server] LMStudio preload returned HTTP ${r.status}; first frontdesk call may be cold`);
        }
      }).catch((err) => {
        console.warn(`[server] LMStudio preload failed (${err.message}); first frontdesk call may be cold`);
      }).finally(() => clearTimeout(t));
    });
  }

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
  // P2 — decision log writer. Always wired; no-ops gracefully if the
  // table isn't there (older DBs that haven't run migration 008).
  const frontdeskDecisionLog = repo && typeof repo.recordFrontdeskDecision === 'function'
    ? createDecisionLog({ repo })
    : null;

  // P2 — pre-bind the LLM runner. Tests can override the whole thing
  // by passing `frontdeskLLM` to createApp; otherwise we construct one
  // from settings (default transport: lmstudio). When frontdesk.llm.enabled
  // is false the runner doesn't get wired at all; if construction fails
  // (e.g. transport=sdk without a client provided), log and skip — the
  // route falls back to rules-only.
  let runtimeRunLLM = frontdeskLLM ?? null;
  if (!runtimeRunLLM && effectiveSettings.frontdesk?.llm?.enabled) {
    try {
      runtimeRunLLM = createRunLLM(effectiveSettings.frontdesk.llm);
    } catch (err) {
      console.warn(`[server] frontdesk.llm enabled but createRunLLM failed (${err.message}); falling back to rules-only`);
      runtimeRunLLM = null;
    }
  }

  app.register(frontdeskRoutes({
    repo,
    getActiveSessions: () => watcher?.snapshot?.() ?? [],
    getQuotaForProvider: async () => null,
    getPrefs: () => ({
      privacyMode: 'normal',
      // P1-11 — frontdesk respects providers[id].enabled. Disabled
      // providers are filtered out of the candidate set before the rule
      // chain runs, so they never appear in `pick.provider`.
      enabledProviders: enabledProviderIds(effectiveSettings),
      // P2 — gate stage 2 on settings.frontdesk.llm.enabled. The runner
      // also requires a runLLM function to actually call the model, so
      // the flag alone never causes a stray network request.
      frontdesk: effectiveSettings.frontdesk,
    }),
    getSignals: () => ({}),
    runLLM: runtimeRunLLM,
    decisionLog: frontdeskDecisionLog,
    getProviderCapabilities: () => app.locals.providerCapabilities,
    // P3-7 — pre-check the local backend so R7 can decide synchronously.
    // The bridge caches healthy results for 5s; unhealthy probes return
    // false within the fetch timeout. Falls back to "no probe" when the
    // aider-local provider isn't enabled.
    getLocalBackendHealthy: getLocalBackendHealthy ?? app.locals.getLocalBackendHealthy ?? undefined,
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
