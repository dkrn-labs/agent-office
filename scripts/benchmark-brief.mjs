#!/usr/bin/env node
// Micro-benchmark: raw memory vs persona brief.
//
// For each (project × persona) slice in the history DB, compute:
//   · raw_tokens    — all observations concatenated as markdown
//   · brief_tokens  — the output of getPersonaBrief()
//   · savings_pct   — (raw - brief) / raw
//
// Output: CSV + a human summary.
//
// This is an INPUT-side measurement (what we would inject at session start).
// It validates Phase A's core claim — the brief is meaningfully smaller than
// the raw memory — independent of any provider.
//
// Run:  node scripts/benchmark-brief.mjs
//       node scripts/benchmark-brief.mjs --budget 800 --out bench.csv

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import fs from 'node:fs';
import { openDatabase, runMigrations } from '../src/db/database.js';
import { estimateTokens, getPersonaBrief, getRawMemory } from '../src/memory/brief/brief.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { budget: 1000, csv: null, briefs: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--budget') out.budget = Number(args[++i]);
    else if (args[i] === '--out') out.csv = args[++i];
    else if (args[i] === '--dump-briefs') out.briefs = args[++i];
  }
  return out;
}

const { budget, csv, briefs } = parseArgs();
const dbPath = process.env.AGENT_OFFICE_DB
  ?? resolve(homedir(), '.agent-office', 'agent-office.db');

const db = openDatabase(dbPath);
await runMigrations(db);

// Enumerate (project, persona) slices with at least one observation.
const slices = db.prepare(`
  SELECT obs.project_id AS projectId, sess.persona_id AS personaId, COUNT(*) AS obsCount
  FROM history_observation obs
  JOIN history_session sess ON sess.history_session_id = obs.history_session_id
  GROUP BY obs.project_id, sess.persona_id
  ORDER BY obsCount DESC
`).all();

// Enrich with project / persona names for readable output.
const projectNames = new Map(
  db.prepare('SELECT project_id, name FROM project').all().map((r) => [r.project_id, r.name]),
);
let personaNames = new Map();
try {
  personaNames = new Map(
    db.prepare('SELECT persona_id, label FROM persona').all().map((r) => [r.persona_id, r.label]),
  );
} catch {
  // persona table shape may vary; personas may all be null anyway for existing data.
}

console.log(`\nPhase A — Brief vs Raw Memory (budget ${budget} tok per brief)\n`);
console.log(
  'project'.padEnd(22) +
  'persona'.padEnd(20) +
  'obs'.padStart(5) +
  '  raw_tok'.padStart(12) +
  ' brief_tok'.padStart(12) +
  '  savings'.padStart(12),
);
console.log('─'.repeat(86));

const rows = [];
let rawTotal = 0;
let briefTotal = 0;

if (briefs) fs.mkdirSync(briefs, { recursive: true });

for (const slice of slices) {
  const raw = getRawMemory(db, { projectId: slice.projectId, personaId: slice.personaId });
  const rawTokens = estimateTokens(raw);

  const brief = await getPersonaBrief(db, {
    projectId: slice.projectId,
    personaId: slice.personaId,
    budgetTokens: budget,
  });

  rawTotal += rawTokens;
  briefTotal += brief.usedTokens;

  const savings = rawTokens > 0 ? (rawTokens - brief.usedTokens) / rawTokens : 0;
  const projectLabel = (projectNames.get(slice.projectId) ?? `#${slice.projectId}`).slice(0, 20);
  const personaLabel = slice.personaId == null
    ? '(unscoped)'
    : (personaNames.get(slice.personaId) ?? `#${slice.personaId}`).slice(0, 18);

  rows.push({
    project: projectLabel,
    persona: personaLabel,
    obsCount: slice.obsCount,
    rawTokens,
    briefTokens: brief.usedTokens,
    savingsPct: Math.round(savings * 1000) / 10,
    briefSources: brief.sourceCount,
  });

  console.log(
    projectLabel.padEnd(22) +
    personaLabel.padEnd(20) +
    String(slice.obsCount).padStart(5) +
    String(rawTokens).padStart(12) +
    String(brief.usedTokens).padStart(12) +
    `${(savings * 100).toFixed(1)}%`.padStart(12),
  );

  if (briefs) {
    const safe = `${projectLabel}-${personaLabel}`.replace(/[^a-z0-9-]/gi, '_');
    fs.writeFileSync(resolve(briefs, `${safe}.md`), brief.markdown);
  }
}

console.log('─'.repeat(86));
const totalSavings = rawTotal > 0 ? (rawTotal - briefTotal) / rawTotal : 0;
console.log(
  'TOTAL'.padEnd(42) +
  ''.padStart(5) +
  String(rawTotal).padStart(12) +
  String(briefTotal).padStart(12) +
  `${(totalSavings * 100).toFixed(1)}%`.padStart(12),
);
console.log();

if (csv) {
  const header = 'project,persona,obs_count,raw_tokens,brief_tokens,savings_pct,brief_sources\n';
  const body = rows.map((r) =>
    `${r.project},${r.persona},${r.obsCount},${r.rawTokens},${r.briefTokens},${r.savingsPct},${r.briefSources}`,
  ).join('\n');
  fs.writeFileSync(csv, header + body + '\n');
  console.log(`  csv → ${csv}`);
}
if (briefs) console.log(`  briefs → ${briefs}/`);

db.close();
