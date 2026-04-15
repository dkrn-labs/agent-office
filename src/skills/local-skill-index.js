import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import os from 'node:os';

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return join(os.homedir(), value.slice(2));
  return value;
}

function parseSkillMetadata(skillFilePath) {
  const raw = readFileSync(skillFilePath, 'utf8');
  const lines = raw.split('\n');
  const titleLine = lines.find((line) => line.trim().startsWith('# '));
  const name = titleLine ? titleLine.trim().replace(/^#\s+/, '') : basename(resolve(skillFilePath, '..'));
  const descriptionLine = lines.find((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('>');
  });
  return {
    name,
    description: descriptionLine?.trim() ?? '',
  };
}

function scanRoot(rootPath) {
  if (!existsSync(rootPath)) return [];

  const entries = readdirSync(rootPath);
  const skills = [];

  for (const entry of entries) {
    const entryPath = join(rootPath, entry);
    let stat;
    try {
      stat = statSync(entryPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const skillFilePath = join(entryPath, 'SKILL.md');
    if (!existsSync(skillFilePath)) continue;

    const metadata = parseSkillMetadata(skillFilePath);
    skills.push({
      id: `local:${entryPath}`,
      name: metadata.name,
      description: metadata.description,
      path: entryPath,
      skillFilePath,
      domain: 'local',
      source: 'local',
      lastUsedAt: null,
      applicableStacks: [],
    });
  }

  return skills;
}

export function getDefaultSkillRoots() {
  return ['~/.agents/skills'];
}

export function scanLocalSkills(skillRoots = getDefaultSkillRoots()) {
  const byName = new Map();
  for (const root of skillRoots) {
    const expandedRoot = expandHome(root);
    for (const skill of scanRoot(expandedRoot)) {
      if (!byName.has(skill.name)) {
        byName.set(skill.name, skill);
      }
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
