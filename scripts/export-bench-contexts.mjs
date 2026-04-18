#!/usr/bin/env node
// Export two context blocks for the lens project into bench/e2e/:
//   raw.md    — every observation as a markdown list (the "no brief" control)
//   brief.md  — getPersonaBrief output (the treatment)
//
// Pair them with the same task prompt and run each through `claude` CLI once.

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import fs from 'node:fs';
import { openDatabase, runMigrations } from '../src/db/database.js';
import { estimateTokens, getPersonaBrief, getRawMemory } from '../src/memory/brief/brief.js';

const projectName = process.argv[2] ?? 'lens';
const dbPath = process.env.AGENT_OFFICE_DB
  ?? resolve(homedir(), '.agent-office', 'agent-office.db');

const db = openDatabase(dbPath);
await runMigrations(db);

const row = db.prepare('SELECT project_id FROM project WHERE name = ?').get(projectName);
if (!row) {
  console.error(`No project named "${projectName}" — pass a different name as argv[1].`);
  process.exit(1);
}
const projectId = row.project_id;

const raw = getRawMemory(db, { projectId });
const brief = await getPersonaBrief(db, { projectId, budgetTokens: 1000 });

const outDir = resolve(process.cwd(), 'bench', 'e2e');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(resolve(outDir, 'raw.md'),   `# Project context (raw memory)\n\n${raw}\n`);
fs.writeFileSync(resolve(outDir, 'brief.md'), `# Project context (brief)\n\n${brief.markdown}\n`);

console.log(`\nExported to ${outDir}/`);
console.log(`  raw.md    ~${estimateTokens(raw)} tokens`);
console.log(`  brief.md  ~${brief.usedTokens} tokens  (savings ${((1 - brief.usedTokens / estimateTokens(raw)) * 100).toFixed(1)}%)`);
console.log();
console.log('Next: run the same task prompt twice with these contexts.');

db.close();
