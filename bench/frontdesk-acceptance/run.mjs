#!/usr/bin/env node
/**
 * 20-task acceptance benchmark for the frontdesk router.
 *
 * Boots a temp DB + repo, seeds default personas, registers default
 * providers, optionally enables the LMStudio LLM transport. For each
 * fixture task, calls `route(...)` directly (no Fastify) and scores
 * the resulting `pick` against the task's expected fields.
 *
 * The benchmark is the test — when it green-lights ≥18/20, the P5-B5
 * task flips `frontdesk.llm.enabled = true` in the default settings.
 *
 *   node bench/frontdesk-acceptance/run.mjs                       # rules-only
 *   node bench/frontdesk-acceptance/run.mjs --llm                  # also test stage 2
 *   node bench/frontdesk-acceptance/run.mjs --report path/to/out.md
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { BUILT_IN_PERSONAS } from '../../src/agents/built-in-personas.js';
import { route } from '../../src/frontdesk/runner.js';
import { listAdapters } from '../../src/providers/manifest.js';
import { createRunLLM } from '../../src/frontdesk/llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { llm: false, report: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--llm') out.llm = true;
    else if (argv[i] === '--report') out.report = argv[++i];
  }
  return out;
}

function loadFixtures() {
  const raw = readFileSync(join(__dirname, 'tasks.json'), 'utf8');
  return JSON.parse(raw);
}

async function bootRepo() {
  const tmp = mkdtempSync(join(os.tmpdir(), 'fd-bench-'));
  const dbPath = join(tmp, 'bench.db');
  const db = openDatabase(dbPath);
  await runMigrations(db);
  const repo = createRepository(db);
  for (const p of BUILT_IN_PERSONAS) {
    repo.createPersona(p);
  }
  // Project so R1 has something to chew on (no attach in fixtures).
  repo.createProject({ name: 'bench-project', path: '/tmp/bench', description: null });
  return { tmp, dbPath, db, repo };
}

function scorePick(pick, expected, candidates) {
  const reasons = [];
  if (expected.personaDomain && pick?.persona?.domain !== expected.personaDomain) {
    reasons.push(`persona domain '${pick?.persona?.domain ?? 'null'}' ≠ '${expected.personaDomain}'`);
  }
  if (expected.providerKind && pick?.provider?.kind !== expected.providerKind) {
    reasons.push(`provider kind '${pick?.provider?.kind ?? 'null'}' ≠ '${expected.providerKind}'`);
  }
  if (expected.mustBeLocal && !candidates?.constraints?.mustBeLocal) {
    reasons.push('expected mustBeLocal=true but candidates.constraints.mustBeLocal was falsy');
  }
  return { pass: reasons.length === 0, reasons };
}

function buildPrefs(taskPrefs) {
  return {
    privacyMode: 'normal',
    dailyDollarCap: null,
    todaySpendDollars: 0,
    localModelLoaded: true, // assume aider-local healthy for the bench run
    enabledProviders: new Set(['claude-code', 'codex', 'gemini-cli', 'aider-local']),
    ...(taskPrefs ?? {}),
  };
}

function fmtRow(row) {
  const status = row.pass ? '✅' : '❌';
  const got = row.pick
    ? `persona=${row.pick?.persona?.domain ?? '?'}, provider=${row.pick?.provider?.id ?? '?'}(${row.pick?.provider?.kind ?? '?'})`
    : `BLOCKED: ${row.blockedReason ?? 'unknown'}`;
  const reasons = row.pass ? '' : ` — ${row.reasons.join('; ')}`;
  return `| ${row.id} | ${status} | ${row.expectedShort} | ${got}${reasons} |`;
}

function buildReport(rows, summary) {
  const lines = [];
  lines.push('# Frontdesk acceptance benchmark report');
  lines.push('');
  lines.push(`**Pass rate:** ${summary.passed}/${summary.total} (${Math.round(100 * summary.passed / summary.total)}%)`);
  lines.push(`**Gate:** ${summary.passed >= 18 ? '✅ PASS — eligible to flip frontdesk.llm.enabled = true' : '❌ FAIL — keep default at false; investigate the failures below'}`);
  lines.push('');
  lines.push('| Task | Result | Expected | Got |');
  lines.push('|---|---|---|---|');
  for (const r of rows) lines.push(fmtRow(r));
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`Generated at ${new Date().toISOString()}`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { tasks } = loadFixtures();
  const { repo } = await bootRepo();

  const adapters = listAdapters();
  // For local-routing tasks the manifest must include aider-local; it
  // is registered by manifest.js but its enable flag in settings is
  // off by default. We bypass settings here and hand the runner the
  // full adapter list.

  const runLLM = args.llm
    ? createRunLLM({
        enabled: true,
        transport: 'lmstudio',
        maxTokens: 1024,
        lmstudio: { host: 'http://localhost:1234', model: 'google/gemma-4-e4b' },
      })
    : null;

  const rows = [];
  for (const t of tasks) {
    const prefs = buildPrefs(t.prefs);
    if (args.llm) prefs.frontdesk = { llm: { enabled: true } };
    let pick = null;
    let candidates = null;
    let blockedReason = null;
    let err = null;
    try {
      const result = await route(
        { repo, prefs, signals: {}, runLLM, getQuotaForProvider: async () => null },
        { task: t.prompt },
      );
      candidates = result.candidates;
      blockedReason = candidates?.constraints?.blockedReason ?? null;
      // The LLM stage returns pick=rulesPick + proposal=<llm output>.
      // For the benchmark we score the LLM proposal when it ran,
      // because that's what the dashboard surfaces to the operator.
      // Map proposal.persona (label) → persona record so the scorer
      // can compare on `domain`, and proposal.provider (id) → provider
      // record from candidates.
      if (result.proposal) {
        const persona = (state) => candidates.personas.find((p) => p.label === state) ?? null;
        const providerOf = (id) => candidates.providers.find((p) => p.id === id) ?? null;
        pick = {
          persona: persona(result.proposal.persona),
          provider: providerOf(result.proposal.provider),
        };
      } else {
        pick = result.pick;
      }
    } catch (e) { err = e; }

    const expectedShort = [
      t.expected.personaDomain ? `persona=${t.expected.personaDomain}` : null,
      t.expected.providerKind ? `provider.kind=${t.expected.providerKind}` : null,
      t.expected.mustBeLocal ? 'mustBeLocal' : null,
    ].filter(Boolean).join(', ');

    if (err) {
      rows.push({ id: t.id, pass: false, reasons: [`runner threw: ${err.message}`], pick: null, blockedReason: null, expectedShort });
      continue;
    }
    if (t.expected.mustBeLocal && blockedReason) {
      // blocked due to "no local provider available" is a *test* fail
      // here because the bench seeds aider-local. Real production may
      // legitimately block when LMStudio is offline.
      rows.push({ id: t.id, pass: false, reasons: [`blocked: ${blockedReason}`], pick: null, blockedReason, expectedShort });
      continue;
    }
    const score = scorePick(pick, t.expected, candidates);
    rows.push({ id: t.id, pass: score.pass, reasons: score.reasons, pick, blockedReason, expectedShort });
  }

  const passed = rows.filter((r) => r.pass).length;
  const summary = { passed, total: rows.length };
  const report = buildReport(rows, summary);

  if (args.report) {
    writeFileSync(args.report, report, 'utf8');
    console.log(`[bench] report written to ${args.report}`);
  }
  console.log('');
  console.log(`Pass rate: ${passed}/${rows.length}`);
  for (const r of rows) {
    if (!r.pass) console.log(`  ${r.id}: ${r.reasons.join('; ')}`);
  }

  process.exit(passed >= 18 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
