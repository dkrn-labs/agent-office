import { z } from 'zod';
import { getAdapter } from '../../providers/manifest.js';

const PtyCreateSchema = z.object({
  shell: z.boolean().optional(),
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  prompt: z.string().optional(),
  historySessionId: z.union([z.number().int(), z.string()]).nullable().optional(),
  argv: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  label: z.string().optional().nullable(),
}).refine(
  (b) => b.shell === true || (typeof b.providerId === 'string' && b.providerId.length > 0) || (Array.isArray(b.argv) && b.argv.length > 0),
  { message: 'one of: { shell: true } | { providerId } | { argv } is required' },
);

/**
 * Routes for spawning + listing in-browser PTY sessions.
 *
 * @param {{ ptyHost: ReturnType<import('../../pty/node-pty-host.js').createPtyHost> }} deps
 * @returns {import('fastify').FastifyPluginAsync}
 */
export function ptyRoutes({ ptyHost }) {
  return async function plugin(fastify) {
    fastify.post('/', async (req, reply) => {
      const parsed = PtyCreateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? 'invalid request body';
        return reply.code(400).send({ data: null, error: message, meta: {} });
      }
      const body = parsed.data;
      let argv;
      let env = {};
      let cwd = body.cwd;
      let label = body.label ?? null;

      try {
        if (body.shell) {
          argv = [process.env.SHELL || '/bin/bash', '-l'];
          cwd = cwd ?? process.env.HOME ?? '/';
          label = label ?? 'shell';
        } else if (body.providerId) {
          const adapter = getAdapter(body.providerId);
          const recipe = adapter.spawn({
            projectPath: cwd ?? process.env.HOME ?? '/',
            systemPrompt: body.prompt ?? '',
            model: body.model,
            historySessionId: body.historySessionId ?? null,
          });
          argv = recipe.argv.map((tok) => (tok === '$PROMPT' ? (body.prompt ?? '') : tok));
          env = recipe.env;
          cwd = recipe.cwd;
          label = label ?? `${adapter.id}:${body.model ?? adapter.defaultModel}`;
        } else if (Array.isArray(body.argv) && body.argv.length > 0) {
          argv = body.argv;
          env = body.env ?? {};
          cwd = cwd ?? process.env.HOME ?? '/';
          label = label ?? body.argv[0];
        } else {
          return reply.code(400).send({
            data: null,
            error: 'one of: { shell: true } | { providerId } | { argv } is required',
            meta: {},
          });
        }
      } catch (err) {
        return reply.code(400).send({ data: null, error: err.message, meta: {} });
      }

      try {
        const { ptyId } = ptyHost.create({
          argv,
          env,
          cwd,
          cols: Number.isInteger(body.cols) ? body.cols : 100,
          rows: Number.isInteger(body.rows) ? body.rows : 30,
          label,
        });
        return { data: { ptyId, label, argv, cwd }, error: null, meta: {} };
      } catch (err) {
        return reply.code(500).send({ data: null, error: err.message, meta: {} });
      }
    });

    fastify.get('/', async () => ({ data: ptyHost.list(), error: null, meta: {} }));

    fastify.delete('/:id', async (req, reply) => {
      const ok = ptyHost.kill(req.params.id);
      if (!ok) return reply.code(404).send({ data: null, error: 'pty not found', meta: {} });
      return reply.code(204).send();
    });
  };
}
