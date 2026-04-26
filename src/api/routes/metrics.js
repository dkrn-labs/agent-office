/**
 * GET /api/_metrics — operational counters in JSON, with optional
 * Prometheus text format via `?format=prometheus`.
 *
 * Each counter is sourced from an injected getter so this route stays
 * pure — no DB calls, no event-bus subscriptions inline. Server.js
 * wires the getters from the existing services.
 *
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function metricsRoutes(deps = {}) {
  return async function plugin(fastify) {
    fastify.get('/', async (req, reply) => {
      const data = {
        sessions: safeCall(deps.countLiveSessions),
        frontdesk: safeCall(deps.countFrontdeskDecisions),
        savings: safeCall(deps.rollupSavingsToday),
        abtop: safeCall(deps.abtopState) ?? { reachable: false, lastTickEpoch: null },
        watchers: safeCall(deps.watcherStats),
      };

      if (String(req.query.format ?? '').toLowerCase() === 'prometheus') {
        const text = renderPrometheus(data);
        reply.type('text/plain; version=0.0.4');
        return text;
      }

      return { data, error: null, meta: { generatedAtEpoch: Math.floor(Date.now() / 1000) } };
    });
  };
}

function safeCall(fn) {
  if (typeof fn !== 'function') return null;
  try { return fn(); }
  catch { return null; }
}

function fmt(name, help, value, type = 'gauge') {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
}

function renderPrometheus(d) {
  const lines = [];
  if (d.sessions) {
    lines.push(fmt('agent_office_sessions_live', 'Live sessions across all providers', d.sessions.live ?? 0));
    for (const [pid, n] of Object.entries(d.sessions.byProvider ?? {})) {
      lines.push(`# HELP agent_office_sessions_by_provider Live sessions per provider`);
      lines.push(`# TYPE agent_office_sessions_by_provider gauge`);
      lines.push(`agent_office_sessions_by_provider{provider="${pid}"} ${n}`);
    }
  }
  if (d.frontdesk) {
    lines.push(fmt('agent_office_frontdesk_decisions_today', 'Frontdesk decisions emitted today', d.frontdesk.today ?? 0, 'counter'));
    lines.push(fmt('agent_office_frontdesk_fallback_rate_7d', 'LLM fallback rate over the last 7 days', d.frontdesk.fallbackRate7d ?? 0));
  }
  if (d.savings) {
    lines.push(fmt('agent_office_savings_dollars_today', 'Cloud-equivalent dollars saved today', d.savings.savedDollarsToday ?? 0));
    lines.push(fmt('agent_office_savings_tokens_7d', 'Tokens saved (baseline minus optimized) over the last 7 days', d.savings.savedTokens7d ?? 0));
  }
  if (d.abtop) {
    lines.push(fmt('agent_office_abtop_reachable', 'abtop bridge reachable (1) or not (0)', d.abtop.reachable ? 1 : 0));
  }
  return lines.join('\n') + '\n';
}
