#!/usr/bin/env node
// LLM-judge pass. For each run, ask a separate Claude CLI call to grade the answer
// against the full raw memory (source of truth). Blinded to condition & repeat.
//
// Output: judgments/<name>.json — {grounded, useful, rationale}

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { openDatabase, runMigrations } from '../src/db/database.js';
import { getRawMemory } from '../src/memory/brief/brief.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RUNS_DIR = resolve(ROOT, 'bench', 'whitepaper', 'runs');
const JUDGE_DIR = resolve(ROOT, 'bench', 'whitepaper', 'judgments');
const TASK_DIR = resolve(ROOT, 'bench', 'whitepaper', 'tasks');
const JUDGE_PROMPT = fs.readFileSync(resolve(ROOT, 'bench', 'whitepaper', 'judge-prompt.md'), 'utf8');

fs.mkdirSync(JUDGE_DIR, { recursive: true });

const PROJECT_NAME = process.env.BENCH_PROJECT ?? 'lens';
const dbPath = process.env.AGENT_OFFICE_DB ?? resolve(homedir(), '.agent-office', 'agent-office.db');
const db = openDatabase(dbPath);
await runMigrations(db);
const row = db.prepare('SELECT project_id FROM project WHERE name = ?').get(PROJECT_NAME);
const rawMemory = getRawMemory(db, { projectId: row.project_id });
db.close();

const TASKS = {
  recall: fs.readFileSync(resolve(TASK_DIR, 'task-recall.md'), 'utf8').trim(),
  planning: fs.readFileSync(resolve(TASK_DIR, 'task-planning.md'), 'utf8').trim(),
  debug: fs.readFileSync(resolve(TASK_DIR, 'task-debug.md'), 'utf8').trim(),
};

function runClaude(prompt) {
  return new Promise((res) => {
    const child = spawn('claude', ['-p', '--output-format', 'json'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', () => res({ stdout: out, stderr: err }));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json')).sort();
console.log(`Judging ${files.length} runs…\n`);

let i = 0;
for (const f of files) {
  i += 1;
  const judgePath = resolve(JUDGE_DIR, f);
  if (fs.existsSync(judgePath)) { console.log(`[${i}/${files.length}] ${f} — skipped`); continue; }

  const run = JSON.parse(fs.readFileSync(resolve(RUNS_DIR, f), 'utf8'));
  const answer = run.result?.result ?? '';
  if (!answer) { console.log(`[${i}/${files.length}] ${f} — no answer, skipping`); continue; }

  const judgePrompt = `${JUDGE_PROMPT}\n\n---\n\n# Source of truth (raw observations)\n\n${rawMemory}\n\n---\n\n# Task\n\n${TASKS[run.task]}\n\n---\n\n# Answer\n\n${answer}`;
  const { stdout } = await runClaude(judgePrompt);
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { /* fallthrough */ }
  const answerJson = parsed?.result ?? parsed;

  let verdict = null;
  if (typeof answerJson === 'string') {
    try { verdict = JSON.parse(answerJson.trim()); } catch { /* */ }
  } else if (answerJson && typeof answerJson === 'object') {
    verdict = answerJson;
  }
  // Last-ditch: scan for JSON in the result string
  if (!verdict && typeof answerJson === 'string') {
    const m = answerJson.match(/\{[^{}]*"grounded"[^{}]*\}/);
    if (m) { try { verdict = JSON.parse(m[0]); } catch { /* */ } }
  }

  fs.writeFileSync(judgePath, JSON.stringify({ name: run.name, task: run.task, condition: run.condition, verdict, rawJudgeResult: answerJson }, null, 2));
  console.log(`[${i}/${files.length}] ${f}  g=${verdict?.grounded ?? '?'} u=${verdict?.useful ?? '?'}`);
}

console.log(`\nDone. Judgments in ${JUDGE_DIR}`);
