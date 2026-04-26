import { rollupSavings } from '../../context-budget/index.js';
import { getAdapter } from '../../providers/manifest.js';

function emptySide() {
  return { sessions: 0, savedTokens: 0, savedDollars: 0 };
}

function computeBreakdown(rows) {
  const cloud = { sessions: 0, baselineTokens: 0, optimizedTokens: 0, savedDollars: 0 };
  const local = { sessions: 0, savedDollars: 0 };
  for (const r of rows) {
    if (r.outcome === 'rejected') continue;
    const adapter = r.providerId ? getAdapter(r.providerId) : null;
    const isLocal = adapter?.kind === 'local';
    if (isLocal) {
      local.sessions += 1;
      // Savings credit for local routing = what this would have cost on
      // a cloud peer (filled by the adapter's cost(usage) at session
      // end). Falls back to 0 when not populated.
      local.savedDollars += Number(r.cloudEquivalentDollars ?? 0);
    } else {
      cloud.sessions += 1;
      cloud.baselineTokens += Number(r.baselineTokens ?? 0);
      cloud.optimizedTokens += Number(r.optimizedTokens ?? 0);
    }
  }
  return {
    cloud: {
      sessions: cloud.sessions,
      savedTokens: Math.max(0, cloud.baselineTokens - cloud.optimizedTokens),
      savedDollars: 0, // cloud "savings" are token-side; $-side is just spend, not savings
    },
    local: { ...emptySide(), ...local },
  };
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

function emptyRollup(range) {
  return {
    range,
    sessions: 0,
    baselineTokens: 0,
    optimizedTokens: 0,
    savedTokens: 0,
    savedPct: 0,
    costDollars: 0,
    breakdown: { cloud: emptySide(), local: emptySide() },
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
      const breakdown = computeBreakdown(rows);
      return {
        data: { range, ...rollup, breakdown },
        error: null,
        meta: { range, since: since(), rowCount: rows.length },
      };
    });
  };
}
