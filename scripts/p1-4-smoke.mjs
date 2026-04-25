import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '/Users/dehakuran/Projects/agent-office/src/db/repository.js';
import { createEventBus } from '/Users/dehakuran/Projects/agent-office/src/core/event-bus.js';
import { createSkillResolver } from '/Users/dehakuran/Projects/agent-office/src/agents/skill-resolver.js';
import { createLauncher } from '/Users/dehakuran/Projects/agent-office/src/agents/launcher.js';
import { createProjectHistoryStore } from '/Users/dehakuran/Projects/agent-office/src/history/project-history.js';

const db = new Database(join(homedir(), '.agent-office', 'agent-office.db'));
const repo = createRepository(db);
const bus = createEventBus();
const resolver = createSkillResolver(repo, { localSkillInventory: [] });
const projectHistory = createProjectHistoryStore(repo, { db, brief: { enabled: false } });

const projects = repo.listProjects();
const synthDebug = projects.find((p) => p.name === 'synth_debug');
const personas = repo.listPersonas();
const persona = personas[0];
console.log('project:', synthDebug?.name, '· persona:', persona?.label);

const launcher = createLauncher({ repo, bus, resolver, dryRun: true, projectHistory });
const before = db.prepare('SELECT COUNT(*) AS n FROM launch_budget').get().n;
const result = await launcher.launch(persona.id, synthDebug.id, { providerId: 'claude-code', model: 'sonnet' });
const after = db.prepare('SELECT COUNT(*) AS n FROM launch_budget').get().n;

console.log('historySessionId:', result.historySessionId);
console.log('launch_budget rows: before=%d after=%d (diff=%d)', before, after, after - before);

const row = db.prepare('SELECT * FROM launch_budget WHERE history_session_id = ?').get(result.historySessionId);
if (row) {
  console.log('baseline=%d  optimized=%d  saved=%d (%d%%)',
    row.baseline_tokens, row.optimized_tokens,
    row.baseline_tokens - row.optimized_tokens,
    Math.round(((row.baseline_tokens - row.optimized_tokens) / row.baseline_tokens) * 100));
  console.log('breakdown(opt):', row.optimized_breakdown);
  console.log('breakdown(base):', row.baseline_breakdown);
}
db.close();
