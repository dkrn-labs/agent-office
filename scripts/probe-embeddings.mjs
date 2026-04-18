#!/usr/bin/env node
// One-off smoke test: load sqlite-vec into better-sqlite3 and compute an embedding.
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { pipeline } from '@huggingface/transformers';

console.log('1) open in-memory db');
const db = new Database(':memory:');
db.pragma('journal_mode = WAL');

console.log('2) load sqlite-vec extension');
sqliteVec.load(db);
const [{ version }] = db.prepare('select vec_version() as version').all();
console.log('   vec version:', version);

console.log('3) create vec table (384-dim, matches MiniLM)');
db.exec('create virtual table t using vec0(embedding float[384])');

console.log('4) load embedding model (first run downloads ~23MB)');
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });

console.log('5) embed a sample');
const out = await extractor('The fixer quietly shipped the release.', { pooling: 'mean', normalize: true });
const vec = Array.from(out.data);
console.log(`   dims=${vec.length}  first5=[${vec.slice(0, 5).map((x) => x.toFixed(3)).join(', ')}...]`);

console.log('6) insert + query');
const vecBytes = Buffer.from(new Float32Array(vec).buffer);
db.prepare('insert into t (rowid, embedding) values (?, ?)').run(BigInt(1), vecBytes);
const nearest = db.prepare(`
  select rowid, distance from t
  where embedding match ? and k = 1
  order by distance
`).all(vecBytes);
console.log('   nearest:', nearest);

console.log('\nOK — toolchain works.');
