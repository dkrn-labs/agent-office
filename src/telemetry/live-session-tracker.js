import { EventEmitter } from 'node:events';

function cloneTotals(totals = {}) {
  return {
    tokensIn: totals.tokensIn ?? 0,
    tokensOut: totals.tokensOut ?? 0,
    cacheRead: totals.cacheRead ?? 0,
    cacheWrite: totals.cacheWrite ?? 0,
    total:
      totals.total ??
      (totals.tokensIn ?? 0) +
        (totals.tokensOut ?? 0) +
        (totals.cacheRead ?? 0) +
        (totals.cacheWrite ?? 0),
  };
}

function sameTotals(a = {}, b = {}) {
  return (
    (a.tokensIn ?? 0) === (b.tokensIn ?? 0) &&
    (a.tokensOut ?? 0) === (b.tokensOut ?? 0) &&
    (a.cacheRead ?? 0) === (b.cacheRead ?? 0) &&
    (a.cacheWrite ?? 0) === (b.cacheWrite ?? 0) &&
    (a.total ?? 0) === (b.total ?? 0)
  );
}

export function createLiveSessionTracker({ idleMs = 10_000, providerId } = {}) {
  const emitter = new EventEmitter();
  const pendingLaunches = [];
  const sessionsByProvider = new Map();

  function buildSnapshot(entry) {
    return {
      sessionId: entry.sessionId,
      providerSessionId: entry.providerSessionId,
      personaId: entry.personaId,
      projectId: entry.projectId,
      projectPath: entry.projectPath,
      startedAt: entry.startedAt,
      lastActivity: entry.lastActivity,
      lastModel: entry.lastModel,
      totals: cloneTotals(entry.totals),
    };
  }

  function prunePending() {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (let i = pendingLaunches.length - 1; i >= 0; i -= 1) {
      if ((pendingLaunches[i].registeredAt ?? 0) < cutoff) pendingLaunches.splice(i, 1);
    }
  }

  function registerLaunch(launch) {
    if (providerId && launch.providerId && launch.providerId !== providerId) return;
    pendingLaunches.push({
      ...launch,
      registeredAt: Date.now(),
    });
    prunePending();
  }

  function claimLaunch({ providerId: candidateProviderId, projectPath, lastActivity }) {
    prunePending();
    const candidateTs = lastActivity ? new Date(lastActivity).getTime() : Number.POSITIVE_INFINITY;
    for (let index = 0; index < pendingLaunches.length; index += 1) {
      const launch = pendingLaunches[index];
      if (launch.projectPath !== projectPath) continue;
      if (launch.providerId && candidateProviderId && launch.providerId !== candidateProviderId) continue;
      const launchTs = launch.launchedAt ? new Date(launch.launchedAt).getTime() : 0;
      if (Number.isFinite(candidateTs) && launchTs - 2_000 > candidateTs) continue;
      return pendingLaunches.splice(index, 1)[0];
    }
    return null;
  }

  function armIdle(entry) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      sessionsByProvider.delete(entry.providerSessionId);
      emitter.emit('session:idle', {
        sessionId: entry.sessionId,
        providerSessionId: entry.providerSessionId,
        personaId: entry.personaId,
        projectId: entry.projectId,
        projectPath: entry.projectPath,
        lastActivity: entry.lastActivity,
      });
    }, idleMs);
  }

  function updateAbsolute({
    providerId: candidateProviderId,
    providerSessionId,
    projectPath,
    lastActivity,
    lastModel,
    totals,
  }) {
    let entry = sessionsByProvider.get(providerSessionId);
    if (!entry) {
      const claimed = claimLaunch({ providerId: candidateProviderId, projectPath, lastActivity });
      if (!claimed) return null;
      entry = {
        providerSessionId,
        sessionId: claimed.sessionId,
        personaId: claimed.personaId,
        projectId: claimed.projectId,
        projectPath,
        startedAt: claimed.launchedAt,
        lastActivity: claimed.launchedAt,
        lastModel: null,
        totals: cloneTotals(),
        idleTimer: null,
      };
      sessionsByProvider.set(providerSessionId, entry);
    }

    const nextTotals = cloneTotals(totals);
    const changed =
      !sameTotals(entry.totals, nextTotals) ||
      entry.lastActivity !== (lastActivity ?? entry.lastActivity) ||
      entry.lastModel !== (lastModel ?? entry.lastModel);

    entry.projectPath = projectPath ?? entry.projectPath;
    entry.lastActivity = lastActivity ?? entry.lastActivity;
    entry.lastModel = lastModel ?? entry.lastModel;
    entry.totals = nextTotals;
    armIdle(entry);

    if (!changed) return buildSnapshot(entry);
    const snapshot = buildSnapshot(entry);
    emitter.emit('session:update', snapshot);
    return snapshot;
  }

  async function stop() {
    for (const entry of sessionsByProvider.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
    }
    sessionsByProvider.clear();
  }

  return {
    registerLaunch,
    updateAbsolute,
    snapshot() {
      return Array.from(sessionsByProvider.values()).map(buildSnapshot);
    },
    stop,
    on(eventName, handler) {
      emitter.on(eventName, handler);
      return () => emitter.off(eventName, handler);
    },
  };
}
