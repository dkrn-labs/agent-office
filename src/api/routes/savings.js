import { Router } from 'express';
import { rollupSavings } from '../../context-budget/index.js';

function ok(res, data, meta = {}) {
  return res.json({ data, error: null, meta });
}

function fail(res, status, message, meta = {}) {
  return res.status(status).json({ data: null, error: message, meta });
}

const RANGES = {
  today: () => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor(startOfDay.getTime() / 1000);
  },
  d7: () => Math.floor(Date.now() / 1000) - 7 * 24 * 3600,
  d30: () => Math.floor(Date.now() / 1000) - 30 * 24 * 3600,
};

/**
 * Savings ledger: rolls up launch_budget rows over a window. Outcome-weighted
 * — `rejected` rows are excluded by `rollupSavings`.
 *
 * GET /api/savings?range=today|7d|30d
 */
export function savingsRoutes({ repo } = {}) {
  const router = Router();
  if (!repo || typeof repo.listLaunchBudgetsSince !== 'function') {
    // No-op router if the host hasn't wired the repo. Returns empty data.
    router.get('/', (_req, res) => ok(res, emptyRollup('today'), { range: 'today' }));
    return router;
  }

  router.get('/', (req, res) => {
    const range = String(req.query.range ?? 'today');
    const since = RANGES[range];
    if (!since) return fail(res, 400, `unknown range: ${range}. expected one of: today, d7, d30`);
    const rows = repo.listLaunchBudgetsSince(since());
    const rollup = rollupSavings(rows);
    return ok(res, { range, ...rollup }, {
      range,
      since: since(),
      rowCount: rows.length,
    });
  });

  return router;
}

function emptyRollup(range) {
  return {
    range,
    sessions: 0,
    baselineTokens: 0,
    optimizedTokens: 0,
    savedTokens: 0,
    savedPct: 0,
    costDollars: 0,
  };
}
