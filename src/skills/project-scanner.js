import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const PROJECT_MARKER_FILES = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
];

/**
 * Detects the tech stack for a project directory.
 * Returns a sorted array of technology strings.
 * @param {string} projectPath
 * @returns {string[]}
 */
export function detectTechStack(projectPath) {
  const stack = new Set();

  // --- package.json (Node / JS ecosystem) ---
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    stack.add('node');
    let pkg = {};
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      // malformed package.json — still mark as node
    }
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    const depNames = Object.keys(allDeps);

    const checks = [
      ['react', 'react'],
      ['vue', 'vue'],
      ['next', 'next'],
      ['express', 'express'],
      ['fastify', 'fastify'],
      ['vite', 'vite'],
      ['tailwindcss', 'tailwind'],
      ['typescript', 'typescript'],
    ];
    for (const [dep, label] of checks) {
      if (depNames.includes(dep)) stack.add(label);
    }
  }

  // --- requirements.txt or pyproject.toml (Python) ---
  if (
    existsSync(join(projectPath, 'requirements.txt')) ||
    existsSync(join(projectPath, 'pyproject.toml'))
  ) {
    stack.add('python');

    // Detect Flask / Django from requirements.txt
    const reqPath = join(projectPath, 'requirements.txt');
    if (existsSync(reqPath)) {
      let reqContent = '';
      try {
        reqContent = readFileSync(reqPath, 'utf8').toLowerCase();
      } catch { /* ignore */ }
      if (/^flask[^-]/m.test(reqContent) || reqContent.includes('flask==') || reqContent.includes('flask>=')) {
        stack.add('flask');
      }
      if (/^django[^-]/m.test(reqContent) || reqContent.includes('django==') || reqContent.includes('django>=')) {
        stack.add('django');
      }
    }

    // Detect Flask / Django from pyproject.toml
    const pyprojectPath = join(projectPath, 'pyproject.toml');
    if (existsSync(pyprojectPath)) {
      let pyContent = '';
      try {
        pyContent = readFileSync(pyprojectPath, 'utf8').toLowerCase();
      } catch { /* ignore */ }
      if (pyContent.includes('flask')) stack.add('flask');
      if (pyContent.includes('django')) stack.add('django');
    }
  }

  // --- Cargo.toml (Rust) ---
  if (existsSync(join(projectPath, 'Cargo.toml'))) {
    stack.add('rust');
  }

  // --- go.mod (Go) ---
  if (existsSync(join(projectPath, 'go.mod'))) {
    stack.add('go');
  }

  // --- Gemfile (Ruby) ---
  if (existsSync(join(projectPath, 'Gemfile'))) {
    stack.add('ruby');
  }

  // --- pom.xml or build.gradle (Java / JVM) ---
  if (
    existsSync(join(projectPath, 'pom.xml')) ||
    existsSync(join(projectPath, 'build.gradle')) ||
    existsSync(join(projectPath, 'build.gradle.kts'))
  ) {
    stack.add('java');
  }

  // --- composer.json (PHP) ---
  if (existsSync(join(projectPath, 'composer.json'))) {
    stack.add('php');
  }

  return [...stack].sort();
}

/**
 * Computes a short, order-independent hash of a tech stack array.
 * @param {string[]} techStack
 * @returns {string} first 16 hex chars of sha256
 */
export function computeStackHash(techStack) {
  const sorted = [...techStack].sort().join(',');
  return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}

/**
 * Returns true when a directory looks like a code project we should index.
 * We include git repos and also non-git folders with common project markers.
 * @param {string} projectPath
 * @returns {boolean}
 */
export function isProjectDirectory(projectPath) {
  if (existsSync(join(projectPath, '.git'))) return true;
  return PROJECT_MARKER_FILES.some((marker) => existsSync(join(projectPath, marker)));
}

/**
 * Scans rootPath for top-level project directories.
 * Skips hidden directories (starting with '.') and node_modules.
 * @param {string} rootPath
 * @returns {{ path: string, name: string, techStack: string[], stackHash: string }[]}
 */
export function scanDirectory(rootPath) {
  let entries;
  try {
    entries = readdirSync(rootPath);
  } catch {
    return [];
  }

  const results = [];

  for (const name of entries) {
    // Skip hidden dirs and node_modules
    if (name.startsWith('.') || name === 'node_modules') continue;

    const fullPath = join(rootPath, name);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    if (!isProjectDirectory(fullPath)) continue;

    const techStack = detectTechStack(fullPath);
    const stackHash = computeStackHash(techStack);
    results.push({ path: fullPath, name, techStack, stackHash });
  }

  return results;
}
