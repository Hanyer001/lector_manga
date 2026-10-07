import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createDatabaseStore } from './database-core.js';

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new Database(filename, { timeout: 3000 });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    const version = db.pragma('user_version', { simple: true });
    if (version > 5) throw new Error('La base de datos requiere una versión más reciente de la aplicación.');
    if (version === 0) db.transaction(() => {
      db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 1');
    })();
    if (version < 2) db.transaction(() => {
      db.exec(readFileSync(new URL('./library-migration.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 2');
    })();
    if (version < 3) db.transaction(() => {
      db.exec(readFileSync(new URL('./reader-migration.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 3');
    })();
    if (version < 4) db.transaction(() => {
      db.exec(readFileSync(new URL('./discovery-migration.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 4');
    })();
    if (version < 5) db.transaction(() => {
      db.exec(readFileSync(new URL('./privacy-migration.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 5');
    })();

    return createDatabaseStore(db, openDatabase);
  } catch (error) {
    db.close();
    throw error;
  }
}
