// Numbered, forward-only migrations (CLAUDE.md §7). The schema version lives in
// SQLite's PRAGMA user_version; each migration runs once inside a transaction.
// Migration 1 is the PRODUCT_SPEC.md §11 baseline. There is intentionally no
// audio table — audio is never persisted (§1.1).
import type { Database } from 'better-sqlite3';

type Migration = { version: number; name: string; sql: string };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE meetings (
        id            INTEGER PRIMARY KEY,
        title         TEXT NOT NULL DEFAULT 'Untitled meeting',
        status        TEXT NOT NULL DEFAULT 'draft',
        started_at    INTEGER,
        ended_at      INTEGER,
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE notes (
        meeting_id    INTEGER PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
        raw_user_md   TEXT NOT NULL DEFAULT '',
        enhanced_json TEXT,
        enhanced_at   INTEGER
      );

      CREATE TABLE transcript_segments (
        id            INTEGER PRIMARY KEY,
        meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        channel       INTEGER NOT NULL,
        speaker_label TEXT NOT NULL,
        text          TEXT NOT NULL,
        start_ms      INTEGER NOT NULL,
        end_ms        INTEGER NOT NULL
      );
      CREATE INDEX idx_segments_meeting ON transcript_segments(meeting_id, start_ms);

      CREATE VIRTUAL TABLE search_fts USING fts5(meeting_id, content);
    `,
  },
];

export function runMigrations(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );
  for (const m of pending) {
    const apply = db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    });
    apply();
  }
}
