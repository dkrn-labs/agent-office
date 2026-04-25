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
  return async function plugin(fastify) {
    fastify.get('/api/sessions/active', async () =>
      (watcher?.snapshot?.() ?? []).map((entry) => mergeLiveSession(repo, entry)),
    );

    fastify.get('/api/sessions', async (req) => {
      const { page, pageSize, personaId, projectId, outcome } = req.query ?? {};
      return repo.listSessionsPage({ page, pageSize, personaId, projectId, outcome });
    });

    fastify.get('/api/sessions/stats', async () => aggregator.getTodayStats());

    fastify.get('/api/sessions/pulse', async () => aggregator.getPulseBuckets());

    fastify.get('/api/sessions/:id', async (req, reply) => {
      const session = repo.getSessionDetail(Number(req.params.id));
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      return session;
    });
  };
}
