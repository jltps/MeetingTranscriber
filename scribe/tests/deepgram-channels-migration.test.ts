/**
 * Migration v10 test (V05 ROADMAP_02). Verifies the additive deepgram_channels
 * column: existing (pre-V05) meetings must default to 2 (they were stereo-captured),
 * while new rows can record 1 (mono). Mirrors tests/organization-migration.test.ts.
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

/** Run migrations with version ≤ maxVersion, in order. */
function dbAtVersion(maxVersion: number): SqliteDb {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (m.version <= maxVersion) db.exec(m.sql);
  }
  return db;
}

describe('migration v10 (deepgram billed channels)', () => {
  it('back-fills existing meetings to 2 channels (they were stereo-captured)', () => {
    // Simulate a pre-V05 install: schema at v9 with a meeting already recorded.
    const db = dbAtVersion(9);
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, deepgram_audio_ms)
       VALUES (1, 'Legacy', 'ended', 0, 60000)`,
    );

    // Apply v10.
    const v10 = MIGRATIONS.find((m) => m.version === 10);
    expect(v10).toBeDefined();
    db.exec(v10!.sql);

    const row = db
      .prepare(`SELECT deepgram_channels FROM meetings WHERE id = 1`)
      .get() as { deepgram_channels: number };
    expect(row.deepgram_channels).toBe(2);
  });

  it('lets new meetings record a single (mono) channel', () => {
    const db = dbAtVersion(10);
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, deepgram_audio_ms, deepgram_channels)
       VALUES (2, 'V05 mono', 'ended', 0, 60000, 1)`,
    );
    const row = db
      .prepare(`SELECT deepgram_channels FROM meetings WHERE id = 2`)
      .get() as { deepgram_channels: number };
    expect(row.deepgram_channels).toBe(1);
  });
});
