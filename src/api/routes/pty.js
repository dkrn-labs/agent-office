import { Router } from 'express';
import { getAdapter } from '../../providers/manifest.js';

function ok(res, data, meta = {}) {
  return res.json({ data, error: null, meta });
}

function fail(res, status, message) {
  return res.status(status).json({ data: null, error: message, meta: {} });
}

/**
 * Routes for spawning + listing in-browser PTY sessions.
 *
 * @param {{ ptyHost: ReturnType<import('../../pty/node-pty-host.js').createPtyHost> }} deps
 */
export function ptyRoutes({ ptyHost }) {
  const router = Router();

  /**
   * POST /api/pty
   * Body shapes accepted:
   *   { shell: true, cwd?, cols?, rows? }                          → bash shell
   *   { providerId, model?, cwd, prompt?, cols?, rows? }           → spawn via adapter
   *   { argv: string[], env?: object, cwd: string, cols?, rows? }  → raw spawn (advanced)
   */
  router.post('/', (req, res) => {
    const body = req.body ?? {};
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
        // Adapter argv may contain '$PROMPT' as a placeholder; for direct PTY
        // spawn we substitute the actual prompt text inline. Other shell-style
        // tokens are passed through as-is.
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
        return fail(res, 400, 'one of: { shell: true } | { providerId } | { argv } is required');
      }
    } catch (err) {
      return fail(res, 400, err.message);
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
      return ok(res, { ptyId, label, argv, cwd }, {});
    } catch (err) {
      return fail(res, 500, err.message);
    }
  });

  router.get('/', (_req, res) => {
    return ok(res, ptyHost.list(), {});
  });

  router.delete('/:id', (req, res) => {
    const ok_ = ptyHost.kill(req.params.id);
    if (!ok_) return fail(res, 404, 'pty not found');
    return res.status(204).end();
  });

  return router;
}
