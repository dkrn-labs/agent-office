// Provider-neutral embedding interface.
//
// Default provider:  @huggingface/transformers running all-MiniLM-L6-v2
//                    (384-dim, ~23MB model, fully offline after first download).
// Optional provider: Ollama /api/embeddings with nomic-embed-text (768-dim).
//
// The brief generator stays provider-agnostic: it asks the interface for
// "embed these strings" and doesn't care which backend handled it. Migrations
// and the vec_observation table are sized for the current provider's dims;
// switching providers means re-embedding.

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DIMS = 384;

let _extractorPromise = null;

async function getXenovaExtractor() {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return pipeline('feature-extraction', DEFAULT_MODEL, { dtype: 'q8' });
    })();
  }
  return _extractorPromise;
}

/**
 * Embed a batch of strings. Returns an array of Float32Array (normalized).
 * @param {string[]} inputs
 * @param {{provider?: 'xenova' | 'ollama', model?: string, ollamaUrl?: string}} [opts]
 * @returns {Promise<{vectors: Float32Array[], model: string, dims: number}>}
 */
export async function embedBatch(inputs, opts = {}) {
  const provider = opts.provider ?? 'xenova';

  if (provider === 'ollama') {
    return embedViaOllama(inputs, opts);
  }

  const extractor = await getXenovaExtractor();
  const vectors = [];
  for (const text of inputs) {
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    vectors.push(new Float32Array(out.data));
  }
  return { vectors, model: DEFAULT_MODEL, dims: DEFAULT_DIMS };
}

async function embedViaOllama(inputs, opts) {
  const url = opts.ollamaUrl ?? 'http://localhost:11434/api/embeddings';
  const model = opts.model ?? 'nomic-embed-text';
  const vectors = [];
  for (const prompt of inputs) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt }),
    });
    if (!res.ok) throw new Error(`Ollama embedding failed: ${res.status}`);
    const body = await res.json();
    vectors.push(new Float32Array(body.embedding));
  }
  const dims = vectors[0]?.length ?? 0;
  return { vectors, model, dims };
}

/** Convenience for single-string embedding. */
export async function embed(text, opts) {
  const { vectors, model, dims } = await embedBatch([text], opts);
  return { vector: vectors[0], model, dims };
}

/**
 * Encode a Float32Array as the BLOB format sqlite-vec expects.
 * @param {Float32Array} vec
 * @returns {Buffer}
 */
export function vecToBlob(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** Cosine similarity between two normalized vectors in [-1, 1]. */
export function cosineSim(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
