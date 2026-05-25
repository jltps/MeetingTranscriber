// better-sqlite3 lives in the main process only (CLAUDE.md §7). The renderer
// reaches it via IPC. The DB file sits under Electron's userData directory.
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { runMigrations } from './migrations';
import { logger } from '../logger';

let db: Database.Database | null = null;

export function initDb(): Database.Database {
  if (db) return db;
  const file = join(app.getPath('userData'), 'scribe.sqlite');
  const instance = new Database(file);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  runMigrations(instance);
  db = instance;
  logger.info('db ready', `v${getSchemaVersion()}`);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database accessed before initDb()');
  return db;
}

export function getSchemaVersion(): number {
  return getDb().pragma('user_version', { simple: true }) as number;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
