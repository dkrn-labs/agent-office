import { rollupSavings } from '../../context-budget/index.js';

const RANGES = {
  today: () => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor(startOfDay.getTime() / 1000);
  },
  d7: () => Math.floor(Date.now() / 1000) - 7 * 24 * 3600,
  d30: () => Math.floor(Date.now() / 1000) - 30 * 24 * 3600,
};

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

/**
 * Savings ledger: rolls up launch_budget rows over a window. Outcome-weighted —
 * `rejected` rows are excluded by `rollupSavings`.
 *
 * GET / (mounted at /api/savings)?range=today|d7|d30
 *
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function savingsRoutes({ repo } = {}) {
  return async function plugin(fastify) {
    if (!repo || typeof repo.listLaunchBudgetsSince !== 'function') {
      fastify.get('/', async () => ({
        data: emptyRollup('today'),
        error: null,
        meta: { range: 'today' },
      }));
      return;
    }

    fastify.get('/', async (req, reply) => {
      const range = String(req.query.range ?? 'today');
      const since = RANGES[range];
      if (!since) {
        return reply.code(400).send({
          data: null,
          error: `unknown range: ${range}. expected one of: today, d7, d30`,
          meta: {},
        });
      }
      const rows = repo.listLaunchBudgetsSince(since());
      const rollup = rollupSavings(rows);
      return {
        data: { range, ...rollup },
        error: null,
        meta: { range, since: since(), rowCount: rows.length },
      };
    });
  };
}
