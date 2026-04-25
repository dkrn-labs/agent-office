#!/usr/bin/env node
// Aggregate run JSON + judgments into stats + CSV + SVG charts.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const RUNS_DIR = resolve(ROOT, 'bench', 'whitepaper', 'runs');
const JUDGE_DIR = resolve(ROOT, 'bench', 'whitepaper', 'judgments');
const CHART_DIR = resolve(ROOT, 'bench', 'whitepaper', 'charts');
const CSV_PATH = resolve(ROOT, 'bench', 'whitepaper', 'results.csv');
const SUMMARY_PATH = resolve(ROOT, 'bench', 'whitepaper', 'summary.json');

fs.mkdirSync(CHART_DIR, { recursive: true });

const files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json')).sort();

const rows = [];
for (const f of files) {
  const run = JSON.parse(fs.readFileSync(resolve(RUNS_DIR, f), 'utf8'));
  const r = run.result ?? {};
  const u = r.usage ?? {};
  let verdict = null;
  const jPath = resolve(JUDGE_DIR, f);
  if (fs.existsSync(jPath)) verdict = JSON.parse(fs.readFileSync(jPath, 'utf8')).verdict;
  rows.push({
    name: run.name,
    task: run.task,
    condition: run.condition,
    repeat: run.repeat,
    wallMs: run.wallMs,
    turns: r.num_turns ?? null,
    costUsd: r.total_cost_usd ?? 0,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreate: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    grounded: verdict?.grounded ?? null,
    useful: verdict?.useful ?? null,
  });
}

// Write CSV
const header = 'name,task,condition,repeat,wallMs,turns,costUsd,inputTokens,outputTokens,cacheCreate,cacheRead,grounded,useful';
const body = rows.map((r) => [r.name, r.task, r.condition, r.repeat, r.wallMs, r.turns, r.costUsd, r.inputTokens, r.outputTokens, r.cacheCreate, r.cacheRead, r.grounded, r.useful].join(',')).join('\n');
fs.writeFileSync(CSV_PATH, header + '\n' + body + '\n');

// Stats
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs) { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); }
function median(xs) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; }

const TASKS = ['recall', 'planning', 'debug'];
const CONDS = ['no-context', 'raw-memory', 'brief'];
const METRICS = ['costUsd', 'wallMs', 'turns', 'inputTokens', 'outputTokens', 'cacheCreate', 'grounded', 'useful'];

const cells = {};
for (const t of TASKS) for (const c of CONDS) {
  const subset = rows.filter((r) => r.task === t && r.condition === c);
  const stats = {};
  for (const m of METRICS) {
    const vals = subset.map((r) => r[m]).filter((v) => v != null);
    stats[m] = { mean: mean(vals), std: std(vals), median: median(vals), n: vals.length };
  }
  cells[`${t}__${c}`] = stats;
}

// Aggregate across tasks
const overall = {};
for (const c of CONDS) {
  const subset = rows.filter((r) => r.condition === c);
  const stats = {};
  for (const m of METRICS) {
    const vals = subset.map((r) => r[m]).filter((v) => v != null);
    stats[m] = { mean: mean(vals), std: std(vals), median: median(vals), n: vals.length };
  }
  overall[c] = stats;
}

const summary = { nRuns: rows.length, cells, overall };
fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

console.log(`\nRuns: ${rows.length}  Tasks: ${TASKS.join('/')}  Conditions: ${CONDS.join('/')}\n`);
console.log('Overall (mean ± std):');
console.log('condition      cost         input-tok    out-tok   turns   wall-s   grounded   useful');
for (const c of CONDS) {
  const s = overall[c];
  console.log(
    `${c.padEnd(13)} $${s.costUsd.mean.toFixed(4)}±${s.costUsd.std.toFixed(4)}  ` +
    `${String(Math.round(s.inputTokens.mean)).padStart(7)}±${String(Math.round(s.inputTokens.std)).padStart(5)}  ` +
    `${String(Math.round(s.outputTokens.mean)).padStart(5)}   ` +
    `${s.turns.mean.toFixed(1).padStart(5)}   ` +
    `${(s.wallMs.mean / 1000).toFixed(1).padStart(6)}  ` +
    `${s.grounded.mean.toFixed(2).padStart(6)}    ` +
    `${s.useful.mean.toFixed(2).padStart(6)}`,
  );
}

// --- SVG charts ---------------------------------------------------------

const COLORS = { 'no-context': '#888', 'raw-memory': '#c0392b', 'brief': '#27ae60' };

function barChart({ title, unit, metric, filename, formatter = (v) => v.toFixed(2) }) {
  const width = 720;
  const height = 360;
  const padL = 80, padB = 70, padT = 50, padR = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const groupCount = TASKS.length + 1; // per-task + overall
  const barsPerGroup = CONDS.length;
  const groupW = plotW / groupCount;
  const barW = (groupW * 0.75) / barsPerGroup;

  const groups = TASKS.map((t) => ({
    label: t,
    values: CONDS.map((c) => cells[`${t}__${c}`][metric]),
  }));
  groups.push({ label: 'ALL', values: CONDS.map((c) => overall[c][metric]) });

  const maxV = Math.max(...groups.flatMap((g) => g.values.map((v) => v.mean + (v.std || 0))));
  const scale = plotH / (maxV * 1.1 || 1);

  const svg = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, system-ui, sans-serif">`);
  svg.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  svg.push(`<text x="${width/2}" y="26" font-size="16" font-weight="600" text-anchor="middle" fill="#111">${title}</text>`);
  svg.push(`<text x="${width/2}" y="${height-10}" font-size="11" text-anchor="middle" fill="#555">task (within-task and overall)</text>`);
  // y-axis
  svg.push(`<text x="16" y="${padT + plotH/2}" font-size="11" text-anchor="middle" fill="#555" transform="rotate(-90 16 ${padT + plotH/2})">${unit}</text>`);
  // gridlines
  for (let i = 0; i <= 5; i++) {
    const y = padT + plotH - (plotH * i) / 5;
    const v = (maxV * 1.1) * i / 5;
    svg.push(`<line x1="${padL}" y1="${y}" x2="${width-padR}" y2="${y}" stroke="#eee"/>`);
    svg.push(`<text x="${padL-6}" y="${y+3}" font-size="10" text-anchor="end" fill="#777">${formatter(v)}</text>`);
  }
  // bars
  groups.forEach((g, gi) => {
    const groupX = padL + gi * groupW + (groupW - barW * barsPerGroup) / 2;
    g.values.forEach((v, bi) => {
      const x = groupX + bi * barW;
      const h = v.mean * scale;
      const y = padT + plotH - h;
      const color = COLORS[CONDS[bi]];
      svg.push(`<rect x="${x}" y="${y}" width="${barW-2}" height="${h}" fill="${color}" opacity="0.85"/>`);
      // error bar
      if (v.std) {
        const eTop = padT + plotH - (v.mean + v.std) * scale;
        const eBot = padT + plotH - Math.max(0, v.mean - v.std) * scale;
        const cx = x + (barW-2)/2;
        svg.push(`<line x1="${cx}" y1="${eTop}" x2="${cx}" y2="${eBot}" stroke="#222" stroke-width="1"/>`);
        svg.push(`<line x1="${cx-3}" y1="${eTop}" x2="${cx+3}" y2="${eTop}" stroke="#222" stroke-width="1"/>`);
        svg.push(`<line x1="${cx-3}" y1="${eBot}" x2="${cx+3}" y2="${eBot}" stroke="#222" stroke-width="1"/>`);
      }
    });
    svg.push(`<text x="${padL + gi*groupW + groupW/2}" y="${padT + plotH + 18}" font-size="11" text-anchor="middle" fill="#333">${g.label}</text>`);
  });
  // legend
  const legY = padT - 18;
  let legX = padL;
  CONDS.forEach((c) => {
    svg.push(`<rect x="${legX}" y="${legY-9}" width="11" height="11" fill="${COLORS[c]}"/>`);
    svg.push(`<text x="${legX+16}" y="${legY}" font-size="11" fill="#333">${c}</text>`);
    legX += 110;
  });
  svg.push('</svg>');
  fs.writeFileSync(resolve(CHART_DIR, filename), svg.join('\n'));
}

barChart({ title: 'Cost per run (USD)', unit: 'USD', metric: 'costUsd', filename: 'cost.svg', formatter: (v) => `$${v.toFixed(2)}` });
barChart({ title: 'Wall-time per run', unit: 'seconds', metric: 'wallMs', filename: 'wall.svg', formatter: (v) => `${Math.round(v/1000)}s` });
barChart({ title: 'Turns per run', unit: 'turns', metric: 'turns', filename: 'turns.svg', formatter: (v) => v.toFixed(1) });
barChart({ title: 'Input tokens per run', unit: 'tokens', metric: 'inputTokens', filename: 'input-tokens.svg', formatter: (v) => `${Math.round(v)}` });
barChart({ title: 'Cache-creation tokens per run', unit: 'tokens', metric: 'cacheCreate', filename: 'cache-create.svg', formatter: (v) => `${Math.round(v)}` });
barChart({ title: 'Judge: groundedness (0–5)', unit: 'score', metric: 'grounded', filename: 'grounded.svg', formatter: (v) => v.toFixed(1) });
barChart({ title: 'Judge: usefulness (0–5)', unit: 'score', metric: 'useful', filename: 'useful.svg', formatter: (v) => v.toFixed(1) });

console.log(`\nCSV → ${CSV_PATH}`);
console.log(`Summary → ${SUMMARY_PATH}`);
console.log(`Charts → ${CHART_DIR}`);
