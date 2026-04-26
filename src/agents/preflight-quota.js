/**
 * Preflight quota check — runs immediately before `spawnItermTab` to
 * avoid launching an agent against a vendor whose 5h/7d quota window is
 * already exhausted (which would dump the user into a CLI that errors
 * on first prompt).
 *
 * P4-A — real signal. When an `abtopSnapshot()` getter is injected
 * (the abtop-bridge), we look up the most-recent session matching the
 * `providerId`, read its `ctxPct`, and reject when ≥ 0.99. When no
 * snapshot is available, fall through to the legacy `getQuotaForProvider`
 * path. Bypass still wins.
 *
 * Tracked in:
 *   - docs/issues/0002-preflight-quota-check.md
 *   - docs/architecture/implementation-plan.md §P4 (abtop-bridge)
 *   - rule R5 in src/frontdesk/rules.js (frontdesk drops >95% quota
 *     providers from candidates pre-launch — preflight is the
 *     last-mile safety net for *direct* attach/relaunch paths that
 *     bypass the frontdesk)
 *
 * @typedef {{
 *   ok: boolean,
 *   reason?: string,                 // human-readable when !ok
 *   quotaPct?: number|null,          // 0..1 when known, null when unknown
 *   resetAtEpoch?: number|null,      // when the window resets
 *   source: 'stub'|'abtop'|'cli'|'override',
 * }} QuotaPreflightResult
 *
 * @param {{
 *   providerId: string,
 *   repo?: object,
 *   getQuotaForProvider?: (providerId: string) => Promise<number|null>,
 *   abtopSnapshot?: () => { sessions: Array<{ pid: number, projectName?: string, model?: string, ctxPct?: number, status?: string }> } | null,
 *   bypass?: boolean,                // dryRun / tests / explicit operator override
 * }} arg
 * @returns {Promise<QuotaPreflightResult>}
 */
export async function checkQuotaBeforeSpawn({
  providerId,
  repo,
  getQuotaForProvider,
  abtopSnapshot,
  bypass = false,
}) {
  if (bypass) return { ok: true, source: 'override' };

  // Path 1 — abtop snapshot (P4-A). Pick the highest ctxPct among
  // sessions whose `model` looks like it belongs to this provider.
  // abtop reports model name (e.g. "opus-4-7") but not provider id;
  // we map by prefix here. A real registry-driven mapper can replace
  // this in P5 once the catalog gains explicit provider→model arrays.
  if (typeof abtopSnapshot === 'function') {
    const snap = abtopSnapshot();
    const sessions = snap?.sessions ?? [];
    const matching = sessions.filter((s) => providerLooksLikeMine(providerId, s));
    if (matching.length) {
      const explicitlyRateLimited = matching.find((s) => s.status === 'rate-limited');
      if (explicitlyRateLimited) {
        return {
          ok: false,
          reason: `${providerId} is rate-limited (abtop saw rate-limit indicator on PID ${explicitlyRateLimited.pid})`,
          quotaPct: 1,
          source: 'abtop',
        };
      }
      const maxCtx = Math.max(...matching.map((s) => s.ctxPct ?? 0));
      if (maxCtx >= 0.99) {
        return {
          ok: false,
          reason: `${providerId} context window is full on the most recent session (${Math.round(maxCtx * 100)}%); start a new session or wait for the existing one to clear`,
          quotaPct: maxCtx,
          source: 'abtop',
        };
      }
      return { ok: true, quotaPct: maxCtx, source: 'abtop' };
    }
  }

  // Path 2 — legacy injected quota fn (kept for tests + frontdesk wiring).
  let quotaPct = null;
  if (typeof getQuotaForProvider === 'function') {
    try { quotaPct = await getQuotaForProvider(providerId); } catch { quotaPct = null; }
  }
  if (typeof quotaPct === 'number' && quotaPct >= 0.99) {
    return {
      ok: false,
      reason: `${providerId} quota window is exhausted (${Math.round(quotaPct * 100)}%); wait for reset or pick another provider`,
      quotaPct,
      source: 'cli',
    };
  }

  return { ok: true, quotaPct, source: quotaPct == null ? 'stub' : 'cli' };
}

/**
 * Map an abtop session's `model` string back to a provider id.
 * abtop reports short model names without the provider; we recognize
 * known prefixes per provider. Misses → false (unmatched, ignored).
 */
function providerLooksLikeMine(providerId, session) {
  const m = (session?.model ?? '').toLowerCase();
  if (!m) return false;
  switch (providerId) {
    case 'claude-code': return m.includes('opus') || m.includes('sonnet') || m.includes('haiku') || m.startsWith('claude-');
    case 'codex': return m.startsWith('gpt-') || m.includes('codex');
    case 'gemini-cli': return m.startsWith('gemini-');
    case 'aider-local': return m.startsWith('openai/') || m.includes('gemma');
    default: return false;
  }
}
