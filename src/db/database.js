import { createRequire } from 'node:module';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// better-sqlite3 is a CommonJS module; use createRequire to import it in ESM.
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

/**
 * Opens (or creates) the SQLite database at dbPath.
 * - Creates the parent directory if it does not exist.
 * - Enables WAL journal mode.
 * - Enables foreign key enforcement.
 * - Creates the _migrations tracking table.
 *
 * @param {string} dbPath  Absolute path to the .db file.
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version     INTEGER PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

/**
 * Applies all unapplied migrations in ascending version order.
 * Each migration is wrapped in a transaction; if any migration fails the
 * transaction is rolled back and the error is re-thrown.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} [migrationsDir]  Directory that contains migration files.
 *   Defaults to the `migrations/` folder next to this file.
 * @returns {Promise<void>}
 */
export async function runMigrations(db, migrationsDir) {
  const dir = migrationsDir ?? join(dirname(new URL(import.meta.url).pathname), 'migrations');

  // Collect *.js files, sort lexicographically (001-… 002-… etc.).
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  // Current applied versions.
  const applied = new Set(
    db.prepare('SELECT version FROM _migrations').all().map((r) => r.version),
  );

  for (const file of files) {
    const filePath = join(dir, file);
    const migration = await import(pathToFileURL(filePath).href);
    const { version, up } = migration;

    if (applied.has(version)) continue;

    // Run inside a transaction so partial failures are rolled back.
    db.transaction(() => {
      up(db);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(version);
    })();
  }
}
