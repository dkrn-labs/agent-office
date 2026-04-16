import { useEffect, useState } from 'react';

const DEFAULT_IDLE_MS = 10_000;

const PROVIDER_IDLE_MS = {
  'claude-code': 10_000,
  codex: 60_000,
  'gemini-cli': 90_000,
};

function toTimestamp(value) {
  if (!value) return Number.NaN;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

export function getSessionIdleMs(session) {
  return PROVIDER_IDLE_MS[session?.providerId] ?? DEFAULT_IDLE_MS;
}

export function isSessionLive(session, now = Date.now()) {
  if (!session?.sessionId) return false;
  if (session.working === false) return false;

  const lastActivityTs = toTimestamp(session.lastActivity ?? session.startedAt);
  if (!Number.isFinite(lastActivityTs)) return Boolean(session.working);

  return now - lastActivityTs < getSessionIdleMs(session);
}

export function getSessionPresence(session, now = Date.now()) {
  if (!session?.sessionId) return 'ready';
  return isSessionLive(session, now) ? 'live' : 'idle';
}

export function useSessionClock(intervalMs = 5_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
