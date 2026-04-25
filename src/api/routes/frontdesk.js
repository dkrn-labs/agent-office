import { Router } from 'express';
import { route } from '../../frontdesk/runner.js';

function ok(res, data, meta = {}) {
  return res.json({ data, error: null, meta });
}

function fail(res, status, message, meta = {}) {
  return res.status(status).json({ data: null, error: message, meta });
}

/**
 * Frontdesk router endpoint — rules-only in P1, becomes hybrid (rules +
 * Haiku LLM) in P2.
 *
 * POST /api/frontdesk/route
 * body: { task: string }
 *
 * @param {{
 *   repo: object,
 *   getActiveSessions?: () => Array,
 *   getQuotaForProvider?: (providerId: string) => Promise<number|null>,
 *   getPrefs?: () => object,
 *   getSignals?: (state) => object,
 * }} deps
 */
export function frontdeskRoutes(deps = {}) {
  const router = Router();

  router.post('/', async (req, res) => {
    const task = req.body?.task;
    if (typeof task !== 'string' || !task.trim()) {
      return fail(res, 400, 'task is required');
    }
    try {
      const prefs = typeof deps.getPrefs === 'function' ? deps.getPrefs() : {};
      const signals = typeof deps.getSignals === 'function' ? deps.getSignals() : {};
      const result = await route(
        { repo: deps.repo, getActiveSessions: deps.getActiveSessions, getQuotaForProvider: deps.getQuotaForProvider, prefs, signals },
        { task },
      );
      if (result.error) return fail(res, 400, result.error);
      return ok(res, result, { stage: 'rules-only' });
    } catch (err) {
      return fail(res, 500, err.message);
    }
  });

  return router;
}
