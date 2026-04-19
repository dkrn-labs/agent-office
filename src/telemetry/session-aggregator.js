import { ACTIVITY_TICK } from '../core/events.js';

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function startOfHour(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), 0, 0, 0);
}

function buildEmptyPulse(hours = 6) {
  const currentHour = startOfHour(new Date());
  return Array.from({ length: hours }, (_, index) => ({
    hourStart: new Date(currentHour.getTime() - (hours - index - 1) * 60 * 60 * 1000).toISOString(),
    tokens: 0,
  }));
}

export function createAggregator({ repo, claudeMem, bus, watcher, tickMs = 60_000 } = {}) {
  let timer = null;
  const unsubscribe = bus?.on?.('session:ended', emitTick);

  function getDistinctFilesToday() {
    if (!claudeMem) return 0;
    const cutoff = startOfToday();
    const files = new Set();
    for (const project of repo.listProjects()) {
      for (const obs of claudeMem.getObservations(project.name, { limit: 200 })) {
        if (!obs.createdAt || obs.createdAt < cutoff) continue;
        for (const file of obs.filesModified ?? []) files.add(file);
      }
    }
    return files.size;
  }

  function getTodayStats() {
    const today = startOfToday();
    const active = watcher?.snapshot?.() ?? [];
    return {
      sessionsToday: repo.countHistorySessionsSince(today),
      filesToday: getDistinctFilesToday(),
      commitsToday: repo.sumHistoryCommitsSince(today),
      allTimeTokens: repo.sumHistoryTokensSince('1970-01-01T00:00:00.000Z'),
      activeSessions: active.length,
    };
  }

  function getPulseBuckets(hours = 6) {
    const buckets = buildEmptyPulse(hours);
    const merged = new Map(buckets.map((bucket) => [bucket.hourStart, { ...bucket }]));
    const since = buckets[0]?.hourStart ?? startOfToday();

    for (const bucket of repo.getHistoryPulseBucketsSince(since)) {
      const target = merged.get(bucket.hourStart);
      if (target) target.tokens += bucket.tokens;
    }

    for (const active of watcher?.snapshot?.() ?? []) {
      const lastActivity = active.lastActivity ? new Date(active.lastActivity) : new Date();
      const key = startOfHour(lastActivity).toISOString();
      const target = merged.get(key);
      if (target) target.tokens += active.totals?.total ?? 0;
    }

    return buckets.map((bucket) => merged.get(bucket.hourStart) ?? bucket);
  }

  function emitTick() {
    bus?.emit?.(ACTIVITY_TICK, {
      stats: getTodayStats(),
      pulseBuckets: getPulseBuckets(),
    });
  }

  function start() {
    if (timer) return;
    timer = setInterval(emitTick, tickMs);
  }

  function stop() {
    if (unsubscribe) unsubscribe();
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    getTodayStats,
    getPulseBuckets,
    emitTick,
    start,
    stop,
  };
}
