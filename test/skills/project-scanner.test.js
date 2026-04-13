import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

import {
  detectTechStack,
  computeStackHash,
  scanDirectory,
} from '../../src/skills/project-scanner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp() {
  return mkdtempSync(join(os.tmpdir(), 'agent-office-scanner-test-'));
}

function writeFile(dir, relPath, content) {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function makeGitRepo(parentDir, name) {
  const repoPath = join(parentDir, name);
  mkdirSync(join(repoPath, '.git'), { recursive: true });
  return repoPath;
}

// ---------------------------------------------------------------------------
// detectTechStack
// ---------------------------------------------------------------------------

describe('detectTechStack()', () => {
  let tmpDir;

  before(() => { tmpDir = makeTmp(); });
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('detects node from package.json', () => {
    const dir = mkdtempSync(join(tmpDir, 'node-'));
    writeFile(dir, 'package.json', JSON.stringify({ name: 'foo' }));
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('node'), `expected "node" in ${JSON.stringify(stack)}`);
  });

  it('detects react from package.json dependencies', () => {
    const dir = mkdtempSync(join(tmpDir, 'react-'));
    writeFile(dir, 'package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } }));
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('react'));
    assert.ok(stack.includes('node'));
  });

  it('detects next from package.json', () => {
    const dir = mkdtempSync(join(tmpDir, 'next-'));
    writeFile(dir, 'package.json', JSON.stringify({ dependencies: { next: '^14.0.0', react: '^18.0.0' } }));
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('next'));
  });

  it('detects express from package.json', () => {
    const dir = mkdtempSync(join(tmpDir, 'express-'));
    writeFile(dir, 'package.json', JSON.stringify({ dependencies: { express: '^4.0.0' } }));
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('express'));
  });

  it('detects fastify from package.json', () => {
    const dir = mkdtempSync(join(tmpDir, 'fastify-'));
    writeFile(dir, 'package.json', JSON.stringify({ dependencies: { fastify: '^4.0.0' } }));
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('fastify'));
  });

  it('detects vite from devDependencies', () => {
    const dir = mkdtempSync(join(tmpDir, 'vite-'));
    writeFile(dir, 'package.json', JSON.stringify({ devDependencies: { vite: '^5.0.0' } }));
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('vite'));
  });

  it('detects tailwind from devDependencies', () => {
    const dir = mkdtempSync(join(tmpDir, 'tw-'));
    writeFile(dir, 'package.json', JSON.stringify({ devDependencies: { tailwindcss: '^3.0.0' } }));
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('tailwind'));
  });

  it('detects typescript from devDependencies', () => {
    const dir = mkdtempSync(join(tmpDir, 'ts-'));
    writeFile(dir, 'package.json', JSON.stringify({ devDependencies: { typescript: '^5.0.0' } }));
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('typescript'));
  });

  it('detects python from requirements.txt', () => {
    const dir = mkdtempSync(join(tmpDir, 'py-'));
    writeFile(dir, 'requirements.txt', 'requests==2.31.0\n');
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('python'), `expected "python" in ${JSON.stringify(stack)}`);
  });

  it('detects python from pyproject.toml', () => {
    const dir = mkdtempSync(join(tmpDir, 'pyproject-'));
    writeFile(dir, 'pyproject.toml', '[tool.poetry]\nname = "myapp"\n');
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('python'));
  });

  it('detects flask from requirements.txt', () => {
    const dir = mkdtempSync(join(tmpDir, 'flask-'));
    writeFile(dir, 'requirements.txt', 'Flask==3.0.0\nrequests>=2.0\n');
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('python'));
    assert.ok(stack.includes('flask'));
  });

  it('detects django from requirements.txt', () => {
    const dir = mkdtempSync(join(tmpDir, 'django-'));
    writeFile(dir, 'requirements.txt', 'Django>=4.2\ngunicorn\n');
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('django'));
  });

  it('detects rust from Cargo.toml', () => {
    const dir = mkdtempSync(join(tmpDir, 'rust-'));
    writeFile(dir, 'Cargo.toml', '[package]\nname = "myapp"\nversion = "0.1.0"\n');
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('rust'), `expected "rust" in ${JSON.stringify(stack)}`);
  });

  it('detects go from go.mod', () => {
    const dir = mkdtempSync(join(tmpDir, 'go-'));
    writeFile(dir, 'go.mod', 'module example.com/myapp\n\ngo 1.22\n');
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('go'), `expected "go" in ${JSON.stringify(stack)}`);
  });

  it('detects ruby from Gemfile', () => {
    const dir = mkdtempSync(join(tmpDir, 'ruby-'));
    writeFile(dir, 'Gemfile', "source 'https://rubygems.org'\ngem 'rails'\n");
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('ruby'));
  });

  it('detects java from pom.xml', () => {
    const dir = mkdtempSync(join(tmpDir, 'java-pom-'));
    writeFile(dir, 'pom.xml', '<project></project>');
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('java'));
  });

  it('detects java from build.gradle', () => {
    const dir = mkdtempSync(join(tmpDir, 'java-gradle-'));
    writeFile(dir, 'build.gradle', 'apply plugin: "java"');
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('java'));
  });

  it('detects php from composer.json', () => {
    const dir = mkdtempSync(join(tmpDir, 'php-'));
    writeFile(dir, 'composer.json', JSON.stringify({ require: { 'php': '>=8.1' } }));
    const stack = detectTechStack(dir);
    assert.ok(stack.includes('php'));
  });

  it('returns empty array for unknown project', () => {
    const dir = mkdtempSync(join(tmpDir, 'empty-'));
    const stack = detectTechStack(dir);
    assert.deepEqual(stack, []);
  });

  it('returns sorted array', () => {
    const dir = mkdtempSync(join(tmpDir, 'sorted-'));
    writeFile(dir, 'package.json', JSON.stringify({
      dependencies: { react: '^18.0.0', express: '^4.0.0' },
      devDependencies: { typescript: '^5.0.0', vite: '^5.0.0' },
    }));
    const stack = detectTechStack(dir);
    const sorted = [...stack].sort();
    assert.deepEqual(stack, sorted, 'result should be sorted');
  });
});

// ---------------------------------------------------------------------------
// computeStackHash
// ---------------------------------------------------------------------------

describe('computeStackHash()', () => {
  it('returns a 16-character hex string', () => {
    const hash = computeStackHash(['node', 'react']);
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]{16}$/);
  });

  it('is consistent — same input gives same hash', () => {
    const h1 = computeStackHash(['node', 'react', 'typescript']);
    const h2 = computeStackHash(['node', 'react', 'typescript']);
    assert.equal(h1, h2);
  });

  it('is order-independent', () => {
    const h1 = computeStackHash(['node', 'react', 'typescript']);
    const h2 = computeStackHash(['typescript', 'node', 'react']);
    assert.equal(h1, h2);
  });

  it('different stacks produce different hashes', () => {
    const h1 = computeStackHash(['node', 'react']);
    const h2 = computeStackHash(['python', 'flask']);
    assert.notEqual(h1, h2);
  });

  it('handles empty array', () => {
    const hash = computeStackHash([]);
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// scanDirectory
// ---------------------------------------------------------------------------

describe('scanDirectory()', () => {
  let rootDir;

  before(() => { rootDir = makeTmp(); });
  after(() => { rmSync(rootDir, { recursive: true, force: true }); });

  it('finds git repos', () => {
    const repoPath = makeGitRepo(rootDir, 'my-app');
    writeFile(repoPath, 'package.json', JSON.stringify({ name: 'my-app' }));

    const results = scanDirectory(rootDir);
    const found = results.find(r => r.name === 'my-app');
    assert.ok(found, 'should find my-app');
    assert.equal(found.path, repoPath);
    assert.ok(Array.isArray(found.techStack));
    assert.ok(found.techStack.includes('node'));
    assert.equal(typeof found.stackHash, 'string');
    assert.equal(found.stackHash.length, 16);
  });

  it('skips directories without .git', () => {
    mkdirSync(join(rootDir, 'not-a-repo'), { recursive: true });
    const results = scanDirectory(rootDir);
    const found = results.find(r => r.name === 'not-a-repo');
    assert.equal(found, undefined, 'should not include non-git dir');
  });

  it('skips hidden directories', () => {
    const hiddenPath = join(rootDir, '.hidden-repo');
    mkdirSync(join(hiddenPath, '.git'), { recursive: true });
    const results = scanDirectory(rootDir);
    const found = results.find(r => r.name === '.hidden-repo');
    assert.equal(found, undefined, 'should skip hidden dirs');
  });

  it('skips node_modules', () => {
    const nmPath = join(rootDir, 'node_modules');
    mkdirSync(join(nmPath, '.git'), { recursive: true });
    const results = scanDirectory(rootDir);
    const found = results.find(r => r.name === 'node_modules');
    assert.equal(found, undefined, 'should skip node_modules');
  });

  it('returns empty array for non-existent rootPath', () => {
    const results = scanDirectory('/tmp/this-path-should-not-exist-agent-office-test');
    assert.deepEqual(results, []);
  });

  it('each result has path, name, techStack, stackHash keys', () => {
    // Use the repo already created in this suite
    const results = scanDirectory(rootDir);
    for (const r of results) {
      assert.ok('path' in r, 'missing path');
      assert.ok('name' in r, 'missing name');
      assert.ok('techStack' in r, 'missing techStack');
      assert.ok('stackHash' in r, 'missing stackHash');
    }
  });

  it('stackHash matches computeStackHash of techStack', () => {
    const results = scanDirectory(rootDir);
    for (const r of results) {
      assert.equal(r.stackHash, computeStackHash(r.techStack));
    }
  });
});
