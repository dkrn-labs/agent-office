/**
 * Claude Project Memory Importer.
 *
 * Reads project-scoped memories that Claude Code writes to:
 *   ~/.claude/projects/<encoded-project-path>/memory/*.md
 *
 * Each .md file may have YAML frontmatter between --- markers:
 *   ---
 *   name: memory-name
 *   description: One line description
 *   type: user
 *   ---
 *   The actual memory content here.
 *
 * Usage:
 *   import { importFromClaudeProjects } from './claude-importer.js';
 *   const result = await importFromClaudeProjects(repo);
 *   // { imported: 3, skipped: 1, projects: ['/Users/dev/my-app'] }
 *
 * @param {ReturnType<import('../db/repository.js').createRepository>} repo
 * @param {string} [claudeDir]  Defaults to ~/.claude/projects
 * @returns {Promise<{ imported: number, skipped: number, projects: string[] }>}
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

/**
 * Decode a Claude-encoded project directory name back to an absolute path.
 * Claude replaces each `/` separator with `-`, so `/Users/dev/my-app` becomes
 * `-Users-dev-my-app`.  We restore the leading slash then replace remaining
 * `-` that sit between path segments back to `/`.
 *
 * The heuristic works for typical Unix paths; the leading `-` maps to the
 * leading `/`.
 *
 * @param {string} encoded  e.g. "-Users-dev-my-app"
 * @returns {string}        e.g. "/Users/dev/my-app"
 */
export function decodeProjectPath(encoded) {
  // Replace ALL hyphens with slashes first, then restore any double-slashes
  // that came from legitimate hyphens in folder names would be ambiguous —
  // but Claude Code itself uses this simple scheme, so we mirror it.
  return encoded.replace(/-/g, '/');
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Extracts the block between the first and second `---` lines, then reads
 * simple `key: value` pairs from it.  Returns { frontmatter, body }.
 *
 * @param {string} content
 * @returns {{ frontmatter: Record<string, string>, body: string }}
 */
export function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: content };
  }

  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlLines = lines.slice(1, closeIdx);
  const body = lines.slice(closeIdx + 1).join('\n').replace(/^\n/, '');

  const frontmatter = {};
  for (const line of yamlLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Import memories from Claude Code's project memory files into the repo.
 *
 * @param {ReturnType<import('../db/repository.js').createRepository>} repo
 * @param {string} [claudeDir]
 * @returns {Promise<{ imported: number, skipped: number, projects: string[] }>}
 */
export async function importFromClaudeProjects(
  repo,
  claudeDir = join(os.homedir(), '.claude', 'projects'),
) {
  // Check claudeDir exists.
  try {
    await stat(claudeDir);
  } catch {
    return { imported: 0, skipped: 0, projects: [] };
  }

  const subdirs = await readdir(claudeDir);
  const existingProjects = repo.listProjects();

  let imported = 0;
  let skipped = 0;
  const touchedProjects = new Set();

  for (const subdir of subdirs) {
    const subdirPath = join(claudeDir, subdir);

    // Only process directories.
    let subdirStat;
    try {
      subdirStat = await stat(subdirPath);
    } catch {
      continue;
    }
    if (!subdirStat.isDirectory()) continue;

    const memoryDir = join(subdirPath, 'memory');
    try {
      await stat(memoryDir);
    } catch {
      continue; // no memory/ folder — skip
    }

    // Decode path and match against known projects.
    const decodedPath = decodeProjectPath(subdir);
    const project = existingProjects.find((p) => p.path === decodedPath);
    if (!project) continue;

    // Read all .md files in the memory directory.
    let memFiles;
    try {
      memFiles = await readdir(memoryDir);
    } catch {
      continue;
    }

    const mdFiles = memFiles.filter((f) => f.endsWith('.md'));
    if (mdFiles.length === 0) continue;

    // Fetch existing memories for this project for dedup check.
    const existingMemories = repo.listMemories({ projectId: project.id });
    const existingContents = new Set(existingMemories.map((m) => m.content));

    for (const mdFile of mdFiles) {
      const filePath = join(memoryDir, mdFile);
      let raw;
      try {
        raw = await readFile(filePath, 'utf8');
      } catch {
        skipped++;
        continue;
      }

      const { frontmatter, body } = parseFrontmatter(raw);
      const content = body.trim();

      // Skip files with no usable content.
      if (!content) {
        skipped++;
        continue;
      }

      // Dedup by content.
      if (existingContents.has(content)) {
        skipped++;
        continue;
      }

      const type = frontmatter.type || 'convention';

      repo.createMemory({
        projectId: project.id,
        domain: 'general',
        type,
        content,
      });

      existingContents.add(content); // prevent intra-run dups
      imported++;
      touchedProjects.add(decodedPath);
    }
  }

  return { imported, skipped, projects: [...touchedProjects] };
}
