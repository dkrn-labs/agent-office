#!/usr/bin/env node
/**
 * Empirical experiment for the P2 frontdesk LLM stage. Runs 5
 * representative routing tasks against a local model via LMStudio's
 * OpenAI-compatible API and reports cold/warm latency, JSON adherence,
 * and reasoning quality.
 *
 * Throw-away script — not wired into the test suite.
 *
 *   Usage: node bench/frontdesk-llm-experiment.mjs [model-id] [host]
 */

import { z } from 'zod';
import { buildPrompt } from '../src/frontdesk/prompt.js';

const MODEL = process.argv[2] ?? 'google/gemma-4-e4b';
const HOST  = process.argv[3] ?? 'http://localhost:1234';
const BACKEND = process.argv[4] ?? (HOST.includes('11434') ? 'ollama' : 'openai');

const ProposalSchema = z.object({
  persona: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  taskType: z.enum(['oneshot', 'iterative', 'long-running']),
  estimatedDuration: z.enum(['<5min', '5-30min', '>30min']),
  complexity: z.number().int().min(1).max(10),
  history_picks: z.array(z.union([z.number(), z.string()])).default([]),
  skills_picks: z.array(z.string()).default([]),
  reasoning: z.string().min(1),
  fallback_if_blocked: z.object({ provider: z.string(), reason: z.string() }).nullable().optional(),
});

// ── Fixture state representing a typical agent-office workspace ──────────────

const STATE = {
  personas: [
    { id: 1, label: 'Backend',  domain: 'backend',  secondaryDomains: ['api'],     systemPromptTemplate: 'You write idiomatic Node/Python backend code.' },
    { id: 2, label: 'Frontend', domain: 'frontend', secondaryDomains: ['ui'],      systemPromptTemplate: 'You write React/Tailwind UI code with accessibility in mind.' },
    { id: 3, label: 'Debug',    domain: 'debug',    secondaryDomains: [],          systemPromptTemplate: 'You hunt bugs methodically — repro, hypothesis, fix.' },
    { id: 4, label: 'DevOps',   domain: 'devops',   secondaryDomains: ['ci'],      systemPromptTemplate: 'You manage deploys, CI, and infrastructure.' },
    { id: 5, label: 'Reviewer', domain: 'review',   secondaryDomains: [],          systemPromptTemplate: 'You review diffs for correctness and style.' },
    { id: 6, label: 'Architect',domain: 'architect',secondaryDomains: ['backend'], systemPromptTemplate: 'You design system structure and migration paths.' },
  ],
  skills: [
    { id: 'tdd',              label: 'TDD',                description: 'Red-green-refactor discipline' },
    { id: 'systematic-debug', label: 'Systematic debugging', description: 'Methodical bug investigation' },
    { id: 'frontend-design',  label: 'Frontend design',    description: 'Distinctive, production-grade UI' },
    { id: 'security-review',  label: 'Security review',    description: 'OWASP / secret leakage / auth checks' },
    { id: 'simplify',         label: 'Simplify',           description: 'Reduce code surface area' },
  ],
  activeSessions: [],
  prefs: { privacyMode: 'open' },
};

const PROVIDERS = [
  { id: 'claude-code',  kind: 'cloud', model: 'claude-opus-4-7' },
  { id: 'codex',        kind: 'cloud', model: 'gpt-5' },
  { id: 'gemini-cli',   kind: 'cloud', model: 'gemini-2.5-pro' },
  { id: 'ollama-aider', kind: 'local', model: 'llama3.1:8b' },
];

// 5 representative tasks — cover the rule classes the router should distinguish.
const TASKS = [
  {
    name: 'short bug fix',
    task: 'fix the login crash when the email field contains a plus sign',
    rulesApplied: ['R9'],   // debug-verb bias
  },
  {
    name: 'mechanical oneshot',
    task: 'rename `getUserById` to `findUserById` across the auth module',
    rulesApplied: ['R10'],
  },
  {
    name: 'long-running refactor',
    task: 'refactor the database layer from raw better-sqlite3 to drizzle-orm across the codebase, preserving the existing migration history and updating every repository call site',
    rulesApplied: ['R11'],
  },
  {
    name: 'frontend feature',
    task: 'add a settings panel where the user can toggle frontdesk LLM transport between sdk, cli, and ollama, with a model picker',
    rulesApplied: [],
  },
  {
    name: 'devops deploy',
    task: 'deploy the new agent-office build to the staging cluster and roll back if smoke tests fail',
    rulesApplied: ['R8'],
  },
];

// ── Render the Anthropic-style prompt blocks to OpenAI chat shape ────────────

function renderForOpenAI({ system, messages }) {
  // LMStudio / OpenAI: a single concatenated `system` string + messages.
  const sys = system.map((b) => b.text).join('\n\n---\n\n');
  return {
    messages: [
      { role: 'system', content: sys },
      ...messages.map((m) => ({
        role: m.role,
        content: Array.isArray(m.content) ? m.content.map((c) => c.text).join('\n') : m.content,
      })),
    ],
  };
}

// ── HTTP helper — OpenAI chat-completions ────────────────────────────────────

async function callModel({ host, model, body, backend }) {
  if (backend === 'ollama') {
    // v0.5+ supports a JSON Schema as `format` for strict structured output.
    const ollamaFormat = body?.response_format?.json_schema?.schema ?? 'json';
    const res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: body.messages,
        stream: false,
        format: ollamaFormat,
        keep_alive: '10m',
        options: { temperature: 0, num_predict: body.max_tokens, num_ctx: 8192 },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return {
      choices: [{ message: { content: j.message?.content ?? '' } }],
      usage: { prompt_tokens: j.prompt_eval_count, completion_tokens: j.eval_count },
    };
  }
  const res = await fetch(`${host}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function extractJSON(text) {
  const trimmed = String(text ?? '').trim();
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf('{');
  const end   = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(trimmed.slice(start, end + 1));
}

// ── Main ─────────────────────────────────────────────────────────────────────

function buildCandidates(rulesApplied) {
  return {
    personas: STATE.personas.map(({ id, label }) => ({ id, label })),
    providers: PROVIDERS.map(({ id, kind }) => ({ id, kind })),
    constraints: { mustBeLocal: false },
    rulesApplied,
  };
}

async function runOnce({ host, model, task, candidates }) {
  const built = buildPrompt({ state: STATE, task, candidates });
  const oai   = renderForOpenAI(built);
  const body  = {
    model,
    temperature: 0,
    max_tokens: 600,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'frontdesk_proposal',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['persona', 'provider', 'model', 'taskType', 'estimatedDuration', 'complexity', 'history_picks', 'skills_picks', 'reasoning'],
          properties: {
            persona: { type: 'string' },
            provider: { type: 'string' },
            model: { type: 'string' },
            taskType: { type: 'string', enum: ['oneshot', 'iterative', 'long-running'] },
            estimatedDuration: { type: 'string', enum: ['<5min', '5-30min', '>30min'] },
            complexity: { type: 'integer', minimum: 1, maximum: 10 },
            history_picks: { type: 'array', items: { type: 'string' } },
            skills_picks: { type: 'array', items: { type: 'string' } },
            reasoning: { type: 'string' },
            fallback_if_blocked: {
              anyOf: [
                { type: 'null' },
                { type: 'object', required: ['provider', 'reason'], properties: { provider: { type: 'string' }, reason: { type: 'string' } } },
              ],
            },
          },
        },
      },
    },
    messages: oai.messages,
  };

  // Approximate input-token count (rough; LMStudio reports actual usage).
  const sysChars = body.messages[0].content.length + body.messages[1].content.length;

  const t0 = performance.now();
  const res = await callModel({ host, model, body, backend: BACKEND });
  const t1 = performance.now();

  const text = res.choices?.[0]?.message?.content ?? '';
  let parsed = null;
  let parseError = null;
  try { parsed = extractJSON(text); } catch (err) { parseError = err.message; }

  let validation = null;
  if (parsed) {
    const v = ProposalSchema.safeParse(parsed);
    validation = v.success ? { ok: true, data: v.data } : { ok: false, issues: v.error.issues };
  }

  return {
    latencyMs: t1 - t0,
    sysChars,
    usage: res.usage ?? null,
    rawText: text,
    parsed,
    parseError,
    validation,
  };
}

async function main() {
  console.log(`\nFrontdesk LLM experiment\n  model: ${MODEL}\n  host:  ${HOST}\n`);

  const summaries = [];
  for (let i = 0; i < TASKS.length; i++) {
    const t = TASKS[i];
    const candidates = buildCandidates(t.rulesApplied);
    process.stdout.write(`[${i + 1}/${TASKS.length}] ${t.name.padEnd(24)} `);
    try {
      const r = await runOnce({ host: HOST, model: MODEL, task: t.task, candidates });
      const ok = r.validation?.ok === true;
      const reasoning = r.validation?.data?.reasoning ?? r.parsed?.reasoning ?? '(none)';
      console.log(`${ok ? '✓' : '✗'} ${r.latencyMs.toFixed(0)}ms · ${r.usage?.prompt_tokens ?? '?'}→${r.usage?.completion_tokens ?? '?'} tok`);
      console.log(`     persona=${r.parsed?.persona}  provider=${r.parsed?.provider}  type=${r.parsed?.taskType}`);
      console.log(`     reasoning: ${reasoning.slice(0, 160)}${reasoning.length > 160 ? '…' : ''}`);
      if (!ok) {
        if (r.parseError) console.log(`     parse error: ${r.parseError}`);
        if (r.validation?.issues) console.log(`     schema issues: ${JSON.stringify(r.validation.issues.slice(0, 3))}`);
      }
      summaries.push({ name: t.name, ok, latencyMs: r.latencyMs, usage: r.usage });
    } catch (err) {
      console.log(`✗ ERROR ${err.message}`);
      summaries.push({ name: t.name, ok: false, error: err.message });
    }
  }

  // Aggregate
  console.log('\n── Summary ─────────────────────────────────────────────────');
  const good = summaries.filter((s) => s.ok);
  const lats = good.map((s) => s.latencyMs).sort((a, b) => a - b);
  const p50  = lats[Math.floor(lats.length * 0.5)] ?? 0;
  const p95  = lats[Math.floor(lats.length * 0.95)] ?? lats[lats.length - 1] ?? 0;
  console.log(`  schema pass:      ${good.length}/${summaries.length}`);
  console.log(`  cold (call #1):   ${summaries[0]?.latencyMs?.toFixed(0)} ms`);
  if (lats.length > 1) {
    const warm = lats.slice(1);
    const warmAvg = warm.reduce((a, b) => a + b, 0) / warm.length;
    console.log(`  warm avg (#2-N):  ${warmAvg.toFixed(0)} ms`);
  }
  console.log(`  p50 / p95:        ${p50.toFixed(0)} / ${p95.toFixed(0)} ms`);
  if (good[0]?.usage) {
    const meanIn  = Math.round(good.reduce((a, b) => a + (b.usage?.prompt_tokens ?? 0), 0) / good.length);
    const meanOut = Math.round(good.reduce((a, b) => a + (b.usage?.completion_tokens ?? 0), 0) / good.length);
    console.log(`  mean tokens:      ${meanIn} in → ${meanOut} out`);
  }
  console.log('');
}

main().catch((err) => { console.error(err); process.exit(1); });
