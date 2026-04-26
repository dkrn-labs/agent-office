# Experiment — Local LLM for the frontdesk router

**Date:** 2026-04-26
**Hardware:** M-series Mac (Apple Silicon)
**Goal:** Decide whether the P2 frontdesk LLM stage can run on a local
small model with usable latency and structured-output reliability,
removing the need for a metered Anthropic API key.

## TL;DR

- **Default backend: LMStudio.** Same Gemma 4 E4B model is **~6× faster
  on LMStudio than on Ollama 0.21.2** on this hardware.
- **Default model: `google/gemma-4-e4b`, GGUF, Q4_K_M, 8k context.**
  Hit 5/5 schema pass on the routing benchmark; reasoning strings were
  short and on-point.
- **Latency:** p50 5.8s, p95 8.7s. *Not* the architecture's <1s target.
  We accept the higher latency in exchange for $0/call, no API key, and
  no quota burn against Claude Max.
- **Cold-load:** 1.32s with warm disk cache. Eager preload at
  `agent-office start` is cheap and hides the cold-start hit.
- **SDK with `ANTHROPIC_API_KEY` stays as opt-in** for users who want
  sub-second routing — same code path, different transport.

## Methodology

A throw-away script (`bench/frontdesk-llm-experiment.mjs`, committed for
reuse) runs 5 representative routing tasks against a target model:

1. **short bug fix** — `fix the login crash when the email field contains a plus sign` (rule R9 — debug-verb bias)
2. **mechanical oneshot** — `rename getUserById to findUserById across the auth module` (R10)
3. **long-running refactor** — multi-line refactor task across the codebase (R11)
4. **frontend feature** — settings panel UI work (no rule trigger)
5. **devops deploy** — `deploy to staging and roll back if smoke tests fail` (R8)

Each call uses the **actual production prompt builder** at
`src/frontdesk/prompt.js` rendered into OpenAI chat-completion shape
with strict `json_schema` constrained decoding when supported. Tasks
include a synthetic `rulesApplied` trace; persona/skill catalogs match
agent-office's defaults. Outputs are parsed and validated against the
production Zod schema (`src/frontdesk/llm.js`).

## Results

### Headline comparison — Gemma 4 E4B, same Q4_K_M quant, both backends

| Backend | Schema pass | p50 | p95 | Cold | Mean tokens |
|---|---|---|---|---|---|
| **LMStudio (`google/gemma-4-e4b`)** | **5/5** | **5.8s** | **8.7s** | 8.7s | 643 in → 126 out |
| Ollama 0.21.2 (`gemma4:e4b`), 32k ctx | 4/5 | 31s | 34s | 22s | 643 in → 127 out |
| Ollama 0.21.2 (`gemma4:e4b`), 8k ctx  | 4/5 | 35s | 42s | 25s | 644 in → 128 out |

Same model file, same quantization, same prompt. The 6× delta is
LMStudio's MLX-aware Metal path vs Ollama's general-purpose runtime.
Ollama 0.21.2 was released hours after Gemma 4 itself; the integration
likely needs another round of optimization. Re-bench when Ollama bumps.

### Sanity check — Ollama isn't slow in general, just for this model

| Model on Ollama 0.21.2 | Schema pass | p50 | p95 | Cold | Notes |
|---|---|---|---|---|---|
| Phi-4-mini 3.8B | 3/5 | 7.2s | 7.4s | 28s | Hallucinated provider ids; weaker reasoning |
| Llama 3.1 8B    | 5/5 | 9.3s | 16.8s | 17s | Hallucinated facts ("OPOSSUM's knowledge graph") |

So Ollama itself runs Llama and Phi at expected speeds — Gemma 4 is the
specific outlier today.

### LMStudio runtime comparison — same model, two engines

| Variant | Schema pass | p50 | p95 | Cold |
|---|---|---|---|---|
| GGUF Q4_K_M (5.9 GB on disk) | 5/5 | **5.8s** | 8.7s | 1.3s warm reload |
| MLX (4B, 8.4 GB on disk) | 5/5 | 9.6s | 28s | 11.6s |

The MLX build is *not* faster despite being framework-native to Apple
Silicon. Stick with GGUF Q4_K_M.

### Quality observations across all runs

- Gemma 4 picked **Debug** for bug-fix, **Architect** for cross-codebase
  refactor, **Frontend** for UI work, **DevOps** for deploy. Reasoning
  strings were 1 sentence, on-point, UI-ready.
- One persistent quality miss across **every** model tested: the
  "rename foo to bar" mechanical task was picked as **Reviewer** instead
  of Backend. Models seem to read "rename" as "review for consistency"
  rather than "do the rename". Worth a few-shot example when we ship
  the learning loop (P5-3).
- **All models picked `provider=claude-code` for almost every task.**
  See "Known limitations" below — this is a prompt issue, not a model
  issue.

## Cold-start economics

| Path | Time | When it happens |
|---|---|---|
| Disk → RAM (cold OS cache) | ~10s | First load after reboot |
| Disk → RAM (warm OS cache) | **1.32s** | Every reload after the first |
| First inference once loaded | ~6s | First call against the loaded model |

**Decision: eager preload at `agent-office start`.** Add ~1.3s to
startup (warm cache); user gets the first routing call ~6s later
without any extra wait. No spinner needed at use-time.

If the user starts cold-cold (first boot of the day), eager preload is
a one-time ~10s tax baked into agent-office startup. Acceptable.

## Known limitations to address in implementation

1. **Vendor selection bias.** All tested models defaulted to
   `provider=claude-code` regardless of task. Root cause: the candidate
   list is positionally ordered with claude-code first, and the prompt
   gives the model no criteria to differentiate between cloud vendors
   (codex / gemini / claude-code) or to choose local (lmstudio / ollama)
   for cheap tasks. **Fix planned:** enrich provider candidates with
   `{label, model, kind, strengths, dailyQuotaPct, $perCall}` and add
   a "When to pick which vendor" block to the system prompt.
2. **JSON schema feature parity.** LMStudio supports strict
   `json_schema`; Ollama supports `format: <schema>` from v0.5+ but
   handles the `type: ['number', 'string']` array notation
   inconsistently. The prompt builder emits a schema that works for
   both, but if we ever add the Ollama path back as a real default,
   we'll need separate schemas.
3. **Run-out-of-tokens on long-running tasks.** The Ollama gemma4 path
   hit the 600-token output cap mid-JSON on one task. Production must
   bump `max_tokens` to 1024 to be safe (cost is trivial at local speed).

## Decisions locked in for the implementation

- **Backend default:** LMStudio. Settings key
  `frontdesk.llm.transport: 'lmstudio'`. Ollama / SDK / CLI remain as
  opt-in alternatives.
- **Model default:** `google/gemma-4-e4b` (GGUF Q4_K_M).
  Settings key `frontdesk.llm.lmstudio.model`.
- **Context length:** 8192. Sufficient for routing-only use. Bumps to
  32k+ if/when local execution lands.
- **Eager preload:** at `agent-office start`, POST `/v1/embeddings` or
  a no-op completion to LMStudio with `keep_alive` to warm the model.
- **`max_tokens`:** 1024 (was 600 in the experiment script — 600 is too
  tight for verbose reasoning).
- **`response_format`:** strict `json_schema`, fall through Zod fallback
  on any miss (existing safety net in `src/frontdesk/llm.js`).
- **Skip LLM stage for trivial tasks:** when rules already produced an
  unambiguous candidate (single persona, single provider, R10 oneshot
  tag), bypass the LLM call. Saves ~6s on mechanical work.
- **Re-bench cadence:** on demand, not on every Ollama release. The
  experiment script is committed at `bench/frontdesk-llm-experiment.mjs`
  for one-line repro.

## How to reproduce

```bash
# 1. Start LMStudio server, load the model
lms server start
lms load google/gemma-4-e4b --gpu max --context-length 8192

# 2. Run the benchmark against any backend
node bench/frontdesk-llm-experiment.mjs google/gemma-4-e4b   # default: LMStudio on :1234
node bench/frontdesk-llm-experiment.mjs <model> http://localhost:11434 ollama
```

The script reuses the production prompt builder and Zod schema, so any
change to either (`src/frontdesk/prompt.js`, `src/frontdesk/llm.js`)
flows directly into the next bench run — no fixture drift.
