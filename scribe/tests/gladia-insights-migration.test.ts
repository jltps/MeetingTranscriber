/**
 * Migration v14 test (V08). Verifies the additive meeting_insights table and the
 * meetings.stt_provider column: created cleanly against a populated v13 DB, the
 * ON DELETE CASCADE FK clears insight rows with their meeting, and existing rows
 * survive.
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

describe('migration v14 (gladia-insights)', () => {
  it('creates meeting_insights + stt_provider against a populated v13 DB', () => {
    const db = dbAtVersion(13);
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, deepgram_audio_ms, deepgram_channels)
       VALUES (1, 'Existing', 'ended', 1000, 5000, 1);
       INSERT INTO transcript_segments (meeting_id, channel, speaker_label, text, start_ms, end_ms)
       VALUES (1, 1, 'Speaker 1', 'hello', 0, 1000);`,
    );

    const v14 = MIGRATIONS.find((m) => m.version === 14);
    expect(v14).toBeDefined();
    db.exec(v14!.sql);

    // Existing meeting + segment survive the migration.
    const meeting = db.prepare(`SELECT COUNT(*) AS n FROM meetings`).get() as { n: number };
    expect(meeting.n).toBe(1);
    const seg = db.prepare(`SELECT COUNT(*) AS n FROM transcript_segments`).get() as { n: number };
    expect(seg.n).toBe(1);

    // stt_provider column exists and defaults to NULL on legacy rows.
    const prov = db.prepare(`SELECT stt_provider FROM meetings WHERE id = 1`).get() as {
      stt_provider: string | null;
    };
    expect(prov.stt_provider).toBeNull();

    // The insights table is empty and writable.
    const before = db.prepare(`SELECT COUNT(*) AS n FROM meeting_insights`).get() as { n: number };
    expect(before.n).toBe(0);
    db.prepare(
      `INSERT INTO meeting_insights (meeting_id, provider, status, insights_json, session_ids_json, error, updated_at)
       VALUES (1, 'gladia', 'ready', '{"utterances":[]}', '["abc"]', NULL, 123)`,
    ).run();
    const row = db.prepare(`SELECT provider, status FROM meeting_insights WHERE meeting_id = 1`).get() as {
      provider: string;
      status: string;
    };
    expect(row).toEqual({ provider: 'gladia', status: 'ready' });
  });

  it('cascades the insights row when the meeting is deleted', () => {
    const db = dbAtVersion(14);
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, deepgram_audio_ms, deepgram_channels, stt_provider)
       VALUES (1, 'Doomed', 'ended', 0, 0, 1, 'gladia');
       INSERT INTO meeting_insights (meeting_id, provider, status, insights_json, session_ids_json, error, updated_at)
       VALUES (1, 'gladia', 'ready', '{}', '[]', NULL, 1);`,
    );
    db.prepare(`DELETE FROM meetings WHERE id = 1`).run();
    const left = db.prepare(`SELECT COUNT(*) AS n FROM meeting_insights`).get() as { n: number };
    expect(left.n).toBe(0);
  });
});
