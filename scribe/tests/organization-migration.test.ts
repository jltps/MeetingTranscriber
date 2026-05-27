/**
 * Migration v9 test (ROADMAP_V04_04). Runs the real migration SQL (v1→v9) against
 * an in-memory node:sqlite DB and asserts the folders/tags schema + the critical
 * §7 invariant: deleting a folder NULLs its meetings' folder_id but never deletes
 * the meetings. Mirrors tests/calendar-migration.test.ts.
 */
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';
import { MIGRATIONS } from '../src/main/db/migrations';

type SqliteStmt = { all: () => unknown[]; get: () => unknown; run: (...args: unknown[]) => void };
type SqliteDb = { exec: (sql: string) => void; prepare: (sql: string) => SqliteStmt };
type SqliteCtor = new (path: string) => SqliteDb;
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: SqliteCtor;
};

function freshDb(): SqliteDb {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    db.exec(m.sql);
  }
  return db;
}

describe('migration v9 (folders + tags)', () => {
  let db: SqliteDb;
  beforeEach(() => {
    db = freshDb();
  });

  it('creates folders, tags, and meeting_tags tables', () => {
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['folders', 'tags', 'meeting_tags']));
  });

  it('adds folder_id and updated_at to meetings', () => {
    const cols = (db.prepare(`PRAGMA table_info('meetings')`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(expect.arrayContaining(['folder_id', 'updated_at']));
  });

  it('deleting a folder NULLs its meetings (never deletes them) — §7', () => {
    db.exec(`INSERT INTO folders (id, name, parent_id, created_at) VALUES (1, 'Clients', NULL, 0)`);
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, folder_id) VALUES (10, 'Acme', 'ended', 0, 1)`,
    );

    db.exec(`DELETE FROM folders WHERE id = 1`);

    const meeting = db.prepare(`SELECT id, folder_id FROM meetings WHERE id = 10`).get() as
      | { id: number; folder_id: number | null }
      | undefined;
    expect(meeting).toBeDefined();
    expect(meeting?.folder_id).toBeNull();
  });

  it('deleting a parent folder cascades to subfolders and NULLs their meetings', () => {
    db.exec(`INSERT INTO folders (id, name, parent_id, created_at) VALUES (1, 'Parent', NULL, 0)`);
    db.exec(`INSERT INTO folders (id, name, parent_id, created_at) VALUES (2, 'Child', 1, 0)`);
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, folder_id) VALUES (10, 'In child', 'ended', 0, 2)`,
    );

    db.exec(`DELETE FROM folders WHERE id = 1`);

    const child = db.prepare(`SELECT id FROM folders WHERE id = 2`).get();
    expect(child).toBeUndefined();
    const meeting = db.prepare(`SELECT folder_id FROM meetings WHERE id = 10`).get() as
      | { folder_id: number | null }
      | undefined;
    expect(meeting?.folder_id).toBeNull();
  });

  it('deleting a meeting cascades its tag links but keeps the tag', () => {
    db.exec(`INSERT INTO meetings (id, title, status, created_at) VALUES (10, 'M', 'ended', 0)`);
    db.exec(`INSERT INTO tags (id, name, created_at) VALUES (5, 'urgent', 0)`);
    db.exec(`INSERT INTO meeting_tags (meeting_id, tag_id) VALUES (10, 5)`);

    db.exec(`DELETE FROM meetings WHERE id = 10`);

    const links = db.prepare(`SELECT COUNT(*) AS n FROM meeting_tags`).get() as { n: number };
    expect(links.n).toBe(0);
    const tag = db.prepare(`SELECT id FROM tags WHERE id = 5`).get();
    expect(tag).toBeDefined();
  });

  it('enforces UNIQUE(parent_id, name) on folders and UNIQUE name on tags', () => {
    db.exec(`INSERT INTO folders (name, parent_id, created_at) VALUES ('Dup', NULL, 0)`);
    expect(() =>
      db.exec(`INSERT INTO folders (name, parent_id, created_at) VALUES ('Dup', NULL, 0)`),
    ).toThrow();

    db.exec(`INSERT INTO tags (name, created_at) VALUES ('t', 0)`);
    expect(() => db.exec(`INSERT INTO tags (name, created_at) VALUES ('t', 0)`)).toThrow();
  });
});
