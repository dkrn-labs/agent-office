/**
 * Paste-image endpoint (P4-B1).
 *
 * Accepts a base64-encoded image from the browser's clipboard paste
 * handler, writes it to ~/.agent-office/paste/<uuid>.<ext>, returns
 * the absolute path. The xterm.js layer then "pastes" that path into
 * the prompt so Claude Code / Codex can attach it.
 *
 * Local-only: the file never leaves disk. The dataDir comes from the
 * server boot, not the request, so a malicious payload cannot redirect
 * the write target.
 *
 * Limits:
 *   - mime allowlist: png/jpeg/gif/webp
 *   - hard cap: 10 MB after decode
 *
 * @returns {import('fastify').FastifyPluginAsync}
 */
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MAX_BYTES = 10 * 1024 * 1024;
const CLEANUP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function pasteRoutes({ dataDir } = {}) {
  if (!dataDir) throw new Error('pasteRoutes requires dataDir');
  const pasteDir = join(dataDir, 'paste');
  mkdirSync(pasteDir, { recursive: true });

  return async function plugin(fastify) {
    fastify.post('/image', async (req, reply) => {
      const body = req.body ?? {};
      const mime = String(body.mime ?? '').toLowerCase();
      const ext = MIME_TO_EXT[mime];
      if (!ext) {
        return reply.code(400).send({
          data: null,
          error: `unsupported mime type: ${mime || '(missing)'}; expected one of: ${Object.keys(MIME_TO_EXT).join(', ')}`,
          meta: {},
        });
      }
      const b64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : null;
      if (!b64) {
        return reply.code(400).send({
          data: null,
          error: 'dataBase64 (base64-encoded image bytes) is required',
          meta: {},
        });
      }
      let buf;
      try { buf = Buffer.from(b64, 'base64'); }
      catch (err) {
        return reply.code(400).send({ data: null, error: `invalid base64: ${err.message}`, meta: {} });
      }
      if (buf.length === 0) {
        return reply.code(400).send({ data: null, error: 'decoded image is empty', meta: {} });
      }
      if (buf.length > MAX_BYTES) {
        return reply.code(413).send({
          data: null,
          error: `image too large: ${buf.length} bytes (max ${MAX_BYTES})`,
          meta: {},
        });
      }
      const filename = `${randomUUID()}.${ext}`;
      const fullPath = join(pasteDir, filename);
      writeFileSync(fullPath, buf);
      return { data: { path: fullPath, bytes: buf.length, mime }, error: null, meta: {} };
    });

    // Best-effort cleanup of files older than 7 days. Runs at plugin
    // load — the cost is one readdir + a few stats per boot.
    fastify.addHook('onReady', async () => {
      try {
        const cutoff = Date.now() - CLEANUP_AFTER_MS;
        for (const name of readdirSync(pasteDir)) {
          const p = join(pasteDir, name);
          try {
            const st = statSync(p);
            if (st.isFile() && st.mtimeMs < cutoff) unlinkSync(p);
          } catch { /* ignore individual file errors */ }
        }
      } catch { /* ignore — directory might not exist on first boot */ }
    });
  };
}
