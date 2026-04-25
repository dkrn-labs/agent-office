import { z } from 'zod';
import { getAdapter } from '../../providers/manifest.js';

const LaunchPtyRequestSchema = z.object({
  personaId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  projectId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  selectedObservationIds: z.array(z.union([z.number().int(), z.string().regex(/^\d+$/)])).optional().nullable(),
  customInstructions: z.string().nullable().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
});

/**
 * @param {ReturnType<import('../../agents/launcher.js').createLauncher>} launcher
 * @param {{ ptyHost?: ReturnType<import('../../pty/node-pty-host.js').createPtyHost> }} [deps]
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function officeRoutes(launcher, { ptyHost } = {}) {
  return async function plugin(fastify) {
    function parseIdList(value) {
      if (value == null) return null;
      if (Array.isArray(value)) return value.map((n) => Number(n)).filter(Number.isInteger);
      if (typeof value === 'string') {
        return value.split(',').map((n) => Number(n.trim())).filter(Number.isInteger);
      }
      return null;
    }

    function statusForLaunchError(err) {
      return err.message?.startsWith('Persona not found') || err.message?.startsWith('Project not found')
        ? 404
        : 500;
    }

    fastify.get('/api/office/preview', async (req, reply) => {
      const { personaId, projectId, providerId, model, selectedObservationIds, customInstructions } = req.query ?? {};
      if (personaId == null || projectId == null) {
        return reply.code(400).send({ error: 'personaId and projectId are required' });
      }
      try {
        return await launcher.preview(Number(personaId), Number(projectId), {
          providerId: providerId ?? undefined,
          model: model ?? undefined,
          selectedObservationIds: parseIdList(selectedObservationIds),
          customInstructions: customInstructions ?? null,
        });
      } catch (err) {
        return reply.code(statusForLaunchError(err)).send({ error: err.message });
      }
    });

    fastify.post('/api/office/launch', async (req, reply) => {
      const { personaId, projectId, providerId, model, selectedObservationIds, customInstructions } = req.body ?? {};
      if (personaId == null || projectId == null) {
        return reply.code(400).send({ error: 'personaId and projectId are required' });
      }
      try {
        const ctx = await launcher.launch(Number(personaId), Number(projectId), {
          providerId: providerId ?? undefined,
          model: model ?? undefined,
          selectedObservationIds: Array.isArray(selectedObservationIds)
            ? selectedObservationIds.map((n) => Number(n)).filter(Number.isInteger)
            : null,
          customInstructions: customInstructions ?? null,
        });
        return { sessionId: ctx.sessionId };
      } catch (err) {
        return reply.code(statusForLaunchError(err)).send({ error: err.message });
      }
    });

    fastify.post('/api/office/launch-pty', async (req, reply) => {
      if (!ptyHost) {
        return reply.code(501).send({ error: 'pty host not available' });
      }
      const parsed = LaunchPtyRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path?.join('.') || 'body';
        return reply.code(400).send({ error: `${path}: ${issue?.message ?? 'invalid'}` });
      }
      const { personaId, projectId, providerId, model, selectedObservationIds, customInstructions, cols, rows } = parsed.data;
      try {
        const ctx = await launcher.prepareLaunch(Number(personaId), Number(projectId), {
          providerId: providerId ?? undefined,
          model: model ?? undefined,
          selectedObservationIds: Array.isArray(selectedObservationIds)
            ? selectedObservationIds.map((n) => Number(n)).filter(Number.isInteger)
            : null,
          customInstructions: customInstructions ?? null,
        });
        const adapter = getAdapter(ctx.providerId);
        const recipe = adapter.spawn({
          projectPath: ctx.projectPath,
          systemPrompt: ctx.systemPrompt,
          model: ctx.model,
          historySessionId: ctx.historySessionId,
        });
        const argv = recipe.argv.map((tok) => (tok === '$PROMPT' ? (ctx.systemPrompt ?? '') : tok));
        const label = `${adapter.id}:${ctx.model ?? adapter.defaultModel}`;
        const { ptyId } = ptyHost.create({
          argv,
          env: recipe.env,
          cwd: recipe.cwd,
          cols: Number.isInteger(cols) ? cols : 100,
          rows: Number.isInteger(rows) ? rows : 30,
          label,
        });
        return {
          sessionId: ctx.sessionId,
          historySessionId: ctx.historySessionId,
          ptyId,
          label,
          providerId: ctx.providerId,
          model: ctx.model,
        };
      } catch (err) {
        return reply.code(statusForLaunchError(err)).send({ error: err.message });
      }
    });

    fastify.get('/api/office/memory-candidates', async (req, reply) => {
      const { personaId, projectId, limit } = req.query ?? {};
      if (personaId == null || projectId == null) {
        return reply.code(400).send({ error: 'personaId and projectId are required' });
      }
      try {
        return await launcher.memoryCandidates(Number(personaId), Number(projectId), {
          limit: limit != null ? Number(limit) : 10,
        });
      } catch (err) {
        return reply.code(500).send({ error: err.message });
      }
    });
  };
}
