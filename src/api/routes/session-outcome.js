/**
 * POST /api/sessions/:id/outcome — operator-confirmed outcome.
 *
 * Body: { outcome: 'accepted'|'partial'|'rejected' }
 *
 * Writes outcome + outcome_source='operator' on history_session_metrics.
 * The heuristic (`inferOutcome`) consults outcome_source and skips when
 * an operator value is set, so this endpoint always wins over the
 * automated classifier. Emits `session:outcome:updated` on the bus so
 * the dashboard can refresh.
 *
 * @returns {import('fastify').FastifyPluginAsync}
 */
const ALLOWED = new Set(['accepted', 'partial', 'rejected']);

export function sessionOutcomeRoutes({ repo, bus } = {}) {
  return async function plugin(fastify) {
    fastify.post('/:id/outcome', async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ data: null, error: 'invalid session id', meta: {} });
      }
      const outcome = req.body?.outcome;
      if (!ALLOWED.has(outcome)) {
        return reply.code(400).send({
          data: null,
          error: `outcome must be one of: ${[...ALLOWED].join(', ')}`,
          meta: {},
        });
      }
      try {
        repo.setHistorySessionOutcome(id, { outcome, source: 'operator' });
      } catch (err) {
        return reply.code(500).send({ data: null, error: err.message, meta: {} });
      }
      try { bus?.emit?.('session:outcome:updated', { historySessionId: id, outcome, source: 'operator' }); }
      catch { /* bus failure shouldn't fail the request */ }
      return { data: { historySessionId: id, outcome, source: 'operator' }, error: null, meta: {} };
    });
  };
}
