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
  {
    version: 2,
    name: 'settings',
    // Key-value app settings. API keys are stored here only as safeStorage-
    // encrypted base64 blobs (CLAUDE.md §1.2) — never plaintext.
    sql: `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: 'templates',
    // Enhancement templates (FEATURES §C) + per-meeting language/template tracking.
    // ALTER TABLE is additive — existing rows survive with NULL/default values.
    // ON DELETE SET NULL: deleting a template never breaks past meetings (CLAUDE.md §7).
    sql: `
      CREATE TABLE templates (
        id            INTEGER PRIMARY KEY,
        name          TEXT    NOT NULL,
        instructions  TEXT    NOT NULL DEFAULT '',
        language_mode TEXT    NOT NULL DEFAULT 'global',
        language_code TEXT,
        is_builtin    INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      ALTER TABLE meetings ADD COLUMN template_id   INTEGER REFERENCES templates(id) ON DELETE SET NULL;
      ALTER TABLE meetings ADD COLUMN language_mode TEXT;
      ALTER TABLE meetings ADD COLUMN language_code TEXT;

      ALTER TABLE notes ADD COLUMN enhanced_lang TEXT;

      -- Seed built-in starter templates.  Guard on is_builtin so re-running is safe.
      INSERT INTO templates (name, instructions, language_mode, is_builtin, created_at, updated_at)
      SELECT 'General', '', 'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      WHERE NOT EXISTS (SELECT 1 FROM templates WHERE is_builtin = 1);

      INSERT INTO templates (name, instructions, language_mode, is_builtin, created_at, updated_at)
      SELECT 'Technical',
             'Focus on technical decisions, architecture choices, and engineering tasks. List any mentioned APIs, systems, or code components with owners.',
             'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      WHERE NOT EXISTS (SELECT 1 FROM templates WHERE name = 'Technical' AND is_builtin = 1);

      INSERT INTO templates (name, instructions, language_mode, is_builtin, created_at, updated_at)
      SELECT 'Sales discovery',
             'Focus on customer pain points, next steps, commitments, and deal context. Identify all action items, owners, and any timeline discussed.',
             'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      WHERE NOT EXISTS (SELECT 1 FROM templates WHERE name = 'Sales discovery' AND is_builtin = 1);

      INSERT INTO templates (name, instructions, language_mode, is_builtin, created_at, updated_at)
      SELECT '1:1',
             'Focus on feedback, blockers, goals, and personal commitments. Highlight anything the manager and report committed to.',
             'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      WHERE NOT EXISTS (SELECT 1 FROM templates WHERE name = '1:1' AND is_builtin = 1);
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
