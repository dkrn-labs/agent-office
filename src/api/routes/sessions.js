import { Router } from 'express';

function mergeLiveSession(repo, liveSession) {
  const detail = repo.getSessionDetail(liveSession.sessionId);
  return {
    ...(detail ?? {}),
    sessionId: liveSession.sessionId,
    id: liveSession.sessionId,
    providerId: liveSession.providerId ?? detail?.providerId ?? null,
    providerSessionId: liveSession.providerSessionId,
    personaId: liveSession.personaId ?? detail?.personaId ?? null,
    projectId: liveSession.projectId ?? detail?.projectId ?? null,
    projectPath: liveSession.projectPath ?? detail?.projectPath ?? null,
    startedAt: liveSession.startedAt ?? detail?.startedAt ?? null,
    lastActivity: liveSession.lastActivity ?? null,
    lastModel: liveSession.lastModel ?? detail?.lastModel ?? null,
    working: liveSession.working ?? true,
    totals: {
      tokensIn: liveSession.totals?.tokensIn ?? detail?.tokensIn ?? 0,
      tokensOut: liveSession.totals?.tokensOut ?? detail?.tokensOut ?? 0,
      cacheRead: liveSession.totals?.cacheRead ?? detail?.tokensCacheRead ?? 0,
      cacheWrite: liveSession.totals?.cacheWrite ?? detail?.tokensCacheWrite ?? 0,
      total: liveSession.totals?.total ?? detail?.totalTokens ?? 0,
      costUsd: detail?.costUsd ?? null,
    },
  };
}

export function sessionRoutes({ repo, watcher, aggregator }) {
  const router = Router();

  router.get('/api/sessions/active', (req, res) => {
    const active = (watcher?.snapshot?.() ?? []).map((entry) => mergeLiveSession(repo, entry));
    res.json(active);
  });

  router.get('/api/sessions', (req, res) => {
    const { page, pageSize, personaId, projectId, outcome } = req.query ?? {};
    res.json(
      repo.listSessionsPage({
        page,
        pageSize,
        personaId,
        projectId,
        outcome,
      }),
    );
  });

  router.get('/api/sessions/stats', (req, res) => {
    res.json(aggregator.getTodayStats());
  });

  router.get('/api/sessions/pulse', (req, res) => {
    res.json(aggregator.getPulseBuckets());
  });

  router.get('/api/sessions/:id', (req, res) => {
    const session = repo.getSessionDetail(Number(req.params.id));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  });

  return router;
}
