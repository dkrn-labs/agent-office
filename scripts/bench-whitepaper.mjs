#!/usr/bin/env node
// Whitepaper benchmark: 3 tasks × 3 conditions × N repeats, randomized, one-shot Claude CLI.
//
// Conditions:
//   no-context   — task only, no memory.
//   raw-memory   — full getRawMemory() prepended.
//   brief        — getPersonaBrief() prepended.
//
// Output: one JSON per run in bench/whitepaper/runs/<task>__<cond>__<i>.json

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { openDatabase, runMigrations } from '../src/db/database.js';
import { getPersonaBrief, getRawMemory } from '../src/memory/brief/brief.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'bench', 'whitepaper', 'runs');
const TASK_DIR = resolve(ROOT, 'bench', 'whitepaper', 'tasks');

const PROJECT_NAME = process.env.BENCH_PROJECT ?? 'lens';
const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);
const BUDGET = Number(process.env.BENCH_BUDGET ?? 1000);

const TASKS = [
  { id: 'recall', file: 'task-recall.md' },
  { id: 'planning', file: 'task-planning.md' },
  { id: 'debug', file: 'task-debug.md' },
];

const CONDITIONS = ['no-context', 'raw-memory', 'brief'];

fs.mkdirSync(OUT_DIR, { recursive: true });

const dbPath = process.env.AGENT_OFFICE_DB ?? resolve(homedir(), '.agent-office', 'agent-office.db');
const db = openDatabase(dbPath);
await runMigrations(db);

const row = db.prepare('SELECT project_id FROM project WHERE name = ?').get(PROJECT_NAME);
if (!row) { console.error(`No project "${PROJECT_NAME}"`); process.exit(1); }
const projectId = row.project_id;

const rawMemory = getRawMemory(db, { projectId });
const briefObj  = await getPersonaBrief(db, { projectId, budgetTokens: BUDGET });
const briefText = briefObj.markdown;

db.close();

const tasks = TASKS.map((t) => ({
  ...t,
  prompt: fs.readFileSync(resolve(TASK_DIR, t.file), 'utf8').trim(),
}));

// Build the full matrix and shuffle.
const matrix = [];
for (const t of tasks)
  for (const c of CONDITIONS)
    for (let i = 0; i < REPEATS; i++)
      matrix.push({ task: t, condition: c, repeat: i });

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
shuffle(matrix);

function buildPrompt(task, condition) {
  if (condition === 'no-context') return task.prompt;
  const context = condition === 'raw-memory' ? rawMemory : briefText;
  const header = condition === 'raw-memory' ? '# Project context (raw memory)' : '# Project context (brief)';
  return `${header}\n\n${context}\n\n# Task\n${task.prompt}`;
}

function runClaude(prompt) {
  return new Promise((resolvePromise) => {
    const child = spawn('claude', ['-p', '--output-format', 'json'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

console.log(`\nBench matrix: ${matrix.length} runs (${tasks.length} tasks × ${CONDITIONS.length} conditions × ${REPEATS} repeats)`);
console.log(`Project: ${PROJECT_NAME} (id ${projectId})`);
console.log(`Brief budget: ${BUDGET} tok — brief size ${briefObj.usedTokens} tok, raw ~${Math.round(rawMemory.length / 4)} tok\n`);

let done = 0;
const startedAt = Date.now();
for (const cell of matrix) {
  const name = `${cell.task.id}__${cell.condition}__${cell.repeat}`;
  const outPath = resolve(OUT_DIR, `${name}.json`);
  if (fs.existsSync(outPath)) {
    console.log(`[${++done}/${matrix.length}] ${name} — skipped (exists)`);
    continue;
  }
  const prompt = buildPrompt(cell.task, cell.condition);
  const t0 = Date.now();
  const { code, stdout, stderr } = await runClaude(prompt);
  const wall = Date.now() - t0;
  done += 1;

  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { /* keep null */ }

  const record = {
    name,
    task: cell.task.id,
    condition: cell.condition,
    repeat: cell.repeat,
    wallMs: wall,
    exitCode: code,
    stderrTail: stderr.slice(-400),
    result: parsed,
    rawStdoutIfParseFailed: parsed ? undefined : stdout.slice(0, 2000),
  };
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));

  const cost = parsed?.total_cost_usd ?? 0;
  const turns = parsed?.num_turns ?? '?';
  console.log(`[${done}/${matrix.length}] ${name}  $${cost.toFixed(4)}  ${turns}turn  ${Math.round(wall / 1000)}s`);
}

const totalSec = Math.round((Date.now() - startedAt) / 1000);
console.log(`\nDone in ${totalSec}s. Runs in ${OUT_DIR}`);
