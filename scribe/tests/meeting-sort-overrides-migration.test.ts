/**
 * Migration v12 test (V072 block 04). Verifies the additive
 * meeting_sort_overrides table: it must be created cleanly against a v11 DB
 * with existing meetings, and the ON DELETE CASCADE FK must clear override
 * rows when the meeting is deleted.
 */
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { MIGRATIONS } from '../src/main/db/migrations';

type SqliteStmt = { all: () => unknown[]; get: () => unknown; run: (...args: unknown[]) => void };
type SqliteDb = { exec: (sql: string) => void; prepare: (sql: string) => SqliteStmt };
type SqliteCtor = new (path: string) => SqliteDb;
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: SqliteCtor;
};

function dbAtVersion(maxVersion: number): SqliteDb {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (m.version <= maxVersion) db.exec(m.sql);
  }
  return db;
}

describe('migration v12 (meeting_sort_overrides)', () => {
  it('creates the table cleanly against a populated v11 DB', () => {
    const db = dbAtVersion(11);
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, deepgram_audio_ms, deepgram_channels)
       VALUES (1, 'Existing', 'ended', 1000, 0, 1)`,
    );

    const v12 = MIGRATIONS.find((m) => m.version === 12);
    expect(v12).toBeDefined();
    db.exec(v12!.sql);

    // The existing meeting is still there; no override row populated.
    const before = db.prepare(`SELECT COUNT(*) AS n FROM meeting_sort_overrides`).get() as {
      n: number;
    };
    expect(before.n).toBe(0);

    db.prepare(
      `INSERT INTO meeting_sort_overrides (meeting_id, sort_mode, position)
       VALUES (1, 'updated', 1000)`,
    ).run();
    const after = db
      .prepare(`SELECT meeting_id, sort_mode, position FROM meeting_sort_overrides`)
      .all() as Array<{ meeting_id: number; sort_mode: string; position: number }>;
    expect(after).toEqual([{ meeting_id: 1, sort_mode: 'updated', position: 1000 }]);
  });

  it('cascades override rows when the meeting is deleted', () => {
    const db = dbAtVersion(12);
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, deepgram_audio_ms, deepgram_channels)
       VALUES (1, 'Doomed', 'ended', 0, 0, 1);
       INSERT INTO meeting_sort_overrides (meeting_id, sort_mode, position)
       VALUES (1, 'updated', 2000), (1, 'title', 3000);`,
    );
    db.prepare(`DELETE FROM meetings WHERE id = 1`).run();
    const left = db.prepare(`SELECT COUNT(*) AS n FROM meeting_sort_overrides`).get() as {
      n: number;
    };
    expect(left.n).toBe(0);
  });

  it('upsert via ON CONFLICT replaces the position for the same (meeting, mode)', () => {
    const db = dbAtVersion(12);
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, deepgram_audio_ms, deepgram_channels)
       VALUES (1, 'Reorder me', 'ended', 0, 0, 1);`,
    );
    const upsert = db.prepare(
      `INSERT INTO meeting_sort_overrides (meeting_id, sort_mode, position)
       VALUES (?, ?, ?)
       ON CONFLICT(meeting_id, sort_mode)
       DO UPDATE SET position = excluded.position`,
    );
    upsert.run(1, 'updated', 1000);
    upsert.run(1, 'updated', 4000);
    const row = db
      .prepare(`SELECT position FROM meeting_sort_overrides WHERE meeting_id = 1 AND sort_mode = 'updated'`)
      .get() as { position: number };
    expect(row.position).toBe(4000);
  });
});
