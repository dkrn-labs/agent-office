/**
 * Low-level client for LMStudio (or any OpenAI-compatible local server).
 *
 * Surfaces three methods used across agent-office:
 *
 *   - `healthCheck()` — cheap GET against `/v1/models`. Cached for
 *     `cacheMs` so frontdesk rule R7 can probe inline without 50–500ms
 *     of latency on every routing call.
 *   - `listModels()`   — returns string[] of model ids (catalog).
 *   - `complete({...})` — POST `/v1/chat/completions`. Throws
 *     `LmStudioError` on transport / HTTP failure.
 *
 * The frontdesk transport (`src/frontdesk/transport-lmstudio.js`) and
 * the upcoming `aider-local` adapter both consume this bridge so the
 * fetch / health-probe / cache code lives in one place.
 */

export class LmStudioError extends Error {
  constructor(message, { cause, status } = {}) {
    super(message);
    this.name = 'LmStudioError';
    if (cause) this.cause = cause;
    if (status) this.status = status;
  }
}

/**
 * @param {{ host: string, cacheMs?: number, fetchImpl?: typeof fetch }} opts
 */
export function createLmStudioBridge({ host, cacheMs = 5000, fetchImpl } = {}) {
  if (!host) throw new Error('createLmStudioBridge: host is required');
  const f = (...a) => (fetchImpl ?? globalThis.fetch)(...a);

  let cached = null; // { at, value }

  async function healthCheckUncached() {
    try {
      const res = await f(`${host}/v1/models`);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { ok: false, reason: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err?.message ?? String(err) };
    }
  }

  async function healthCheck() {
    const now = Date.now();
    if (cached && now - cached.at < cacheMs) return cached.value;
    const value = await healthCheckUncached();
    cached = { at: now, value };
    return value;
  }

  async function listModels() {
    let res;
    try {
      res = await f(`${host}/v1/models`);
    } catch (err) {
      throw new LmStudioError(`fetch failed: ${err?.message ?? err}`, { cause: err });
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new LmStudioError(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`, { status: res.status });
    }
    const payload = await res.json();
    return Array.isArray(payload?.data) ? payload.data.map((m) => m.id) : [];
  }

  /**
   * @param {{
   *   model: string,
   *   messages: Array<{ role: string, content: string }>,
   *   maxTokens?: number,
   *   temperature?: number,
   *   responseFormat?: object,
   *   keepAlive?: string,
   * }} arg
   */
  async function complete({ model, messages, maxTokens = 1024, temperature = 0, responseFormat, keepAlive }) {
    const body = {
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
    };
    if (responseFormat) body.response_format = responseFormat;
    if (keepAlive) body.keep_alive = keepAlive;

    let res;
    try {
      res = await f(`${host}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LmStudioError(`fetch failed: ${err?.message ?? err}`, { cause: err });
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new LmStudioError(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`, { status: res.status });
    }
    return res.json();
  }

  return { host, healthCheck, listModels, complete };
}
