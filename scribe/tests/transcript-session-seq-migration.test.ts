/**
 * Migration v15 test (V081). Verifies the additive `session_seq` column on
 * transcript_segments: created cleanly against a populated v14 DB, defaults to 1
 * for existing rows, and accepts higher session indices for appended recordings.
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

describe('migration v15 (transcript session_seq)', () => {
  it('adds session_seq defaulting to 1 for existing rows', () => {
    const db = dbAtVersion(14);
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, deepgram_audio_ms, deepgram_channels)
       VALUES (1, 'M', 'ended', 0, 0, 1);
       INSERT INTO transcript_segments (meeting_id, channel, speaker_label, text, start_ms, end_ms)
       VALUES (1, 1, 'Speaker 1', 'old', 0, 1000);`,
    );

    const v15 = MIGRATIONS.find((m) => m.version === 15);
    expect(v15).toBeDefined();
    db.exec(v15!.sql);

    const existing = db
      .prepare(`SELECT session_seq FROM transcript_segments WHERE text = 'old'`)
      .get() as { session_seq: number };
    expect(existing.session_seq).toBe(1);

    // A second-session segment records a higher index.
    db.prepare(
      `INSERT INTO transcript_segments (meeting_id, channel, speaker_label, text, start_ms, end_ms, session_seq)
       VALUES (1, 1, 'Speaker 1', 'new', 60000, 61000, 2)`,
    ).run();
    const rows = db
      .prepare(`SELECT text, session_seq FROM transcript_segments ORDER BY session_seq`)
      .all() as Array<{ text: string; session_seq: number }>;
    expect(rows).toEqual([
      { text: 'old', session_seq: 1 },
      { text: 'new', session_seq: 2 },
    ]);
  });
});
