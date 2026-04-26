/**
 * Preflight quota check — runs immediately before `spawnItermTab` to
 * avoid launching an agent against a vendor whose 5h/7d quota window is
 * already exhausted (which would dump the user into a CLI that errors
 * on first prompt).
 *
 * STUB. Returns `{ ok: true, source: 'stub' }` until real per-provider
 * quota signals land in P4 (abtop-bridge). The signature and call site
 * are stable so the production version is a drop-in replacement.
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
 *   bypass?: boolean,                // dryRun / tests / explicit operator override
 * }} arg
 * @returns {Promise<QuotaPreflightResult>}
 */
export async function checkQuotaBeforeSpawn({
  providerId,
  repo,
  getQuotaForProvider,
  bypass = false,
}) {
  if (bypass) return { ok: true, source: 'override' };

  // TODO(P4): replace with real abtop-bridge quota lookup.
  // Sketch of the production path:
  //   const sample = await abtop.querySample(providerId);
  //   if (sample?.quotaPct >= 0.99) return { ok: false, reason: '...' };
  //   if (sample?.quotaPct >= 0.95) return { ok: true, warning: 'near-cap' };
  //
  // Until then, opportunistically use whatever getQuotaForProvider already
  // returns — currently null from server.js, but tests can inject.
  let quotaPct = null;
  if (typeof getQuotaForProvider === 'function') {
    try { quotaPct = await getQuotaForProvider(providerId); } catch { quotaPct = null; }
  }

  if (typeof quotaPct === 'number' && quotaPct >= 0.99) {
    return {
      ok: false,
      reason: `${providerId} quota window is exhausted (${Math.round(quotaPct * 100)}%); wait for reset or pick another provider`,
      quotaPct,
      source: 'stub',
    };
  }

  return { ok: true, quotaPct, source: 'stub' };
}
