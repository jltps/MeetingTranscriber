/**
 * Migration v8 test (ROADMAP_06). Runs the real migration SQL (v1→v8) against an
 * in-memory node:sqlite DB and asserts the calendar schema + the critical §7
 * invariant: deleting a calendar event NULLs the meeting link but never deletes
 * the meeting.
 *
 * Note: the production runner uses better-sqlite3 (Electron-only); here we apply
 * the same SQL via node:sqlite, which the test runner's Node provides.
 */
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';
import { MIGRATIONS } from '../src/main/db/migrations';

// node:sqlite is a newer builtin Vite 5's import analyzer doesn't recognize (it
// strips the `node:` scheme and fails to resolve "sqlite"), and @types/node@20
// doesn't ship its types — so we load it via createRequire and describe only the
// minimal surface this test uses (no `any`, per CLAUDE.md §5).
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

describe('migration v8 (calendar)', () => {
  let db: SqliteDb;
  beforeEach(() => {
    db = freshDb();
  });

  it('creates calendar_events with the expected columns', () => {
    const cols = (db.prepare(`PRAGMA table_info('calendar_events')`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'provider_id',
        'external_id',
        'title',
        'start_ms',
        'end_ms',
        'all_day',
        'join_url',
        'attendees_json',
        'armed',
        'synced_at',
      ]),
    );
  });

  it('adds calendar_event_id to meetings', () => {
    const cols = (db.prepare(`PRAGMA table_info('meetings')`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('calendar_event_id');
  });

  it('enforces UNIQUE(provider_id, external_id)', () => {
    const insert = `INSERT INTO calendar_events (provider_id, external_id, start_ms, end_ms, synced_at)
                    VALUES ('google', 'dup', 1, 2, 0)`;
    db.exec(insert);
    expect(() => db.exec(insert)).toThrow();
  });

  it('SET NULL on event delete keeps the meeting alive', () => {
    db.exec(`INSERT INTO calendar_events (id, provider_id, external_id, start_ms, end_ms, synced_at)
             VALUES (1, 'google', 'evt', 1, 2, 0)`);
    db.exec(`INSERT INTO meetings (id, title, status, created_at, calendar_event_id)
             VALUES (10, 'Linked', 'draft', 0, 1)`);

    db.exec(`DELETE FROM calendar_events WHERE id = 1`);

    const meeting = db.prepare(`SELECT id, calendar_event_id FROM meetings WHERE id = 10`).get() as
      | { id: number; calendar_event_id: number | null }
      | undefined;
    expect(meeting).toBeDefined();
    expect(meeting?.calendar_event_id).toBeNull();
  });
});
