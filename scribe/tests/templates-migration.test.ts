/**
 * Migration v11 test (V06 block 01). The built-in templates were seeded (v5) with the
 * FULL system prompt — tool-use/sourceSegmentIds mechanics — in `instructions`. v11
 * reseeds them with guidance-only text and does so via UPDATE-in-place so that
 * meetings.template_id references to a built-in survive (a DELETE would null them via
 * ON DELETE SET NULL). User-created templates must be untouched, and re-running must be
 * idempotent. Mirrors tests/deepgram-channels-migration.test.ts.
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

const v11sql = () => {
  const m = MIGRATIONS.find((x) => x.version === 11);
  expect(m).toBeDefined();
  return m!.sql;
};

const builtinInstructions = (db: SqliteDb, name: string): string =>
  (
    db
      .prepare(`SELECT instructions FROM templates WHERE is_builtin = 1 AND name = '${name}'`)
      .get() as { instructions: string }
  ).instructions;

describe('migration v11 (templates guidance-only reseed)', () => {
  it('strips the LLM mechanics from every built-in template', () => {
    const db = dbAtVersion(10);
    // Sanity: the v5 seed left the mechanics in `instructions`.
    expect(builtinInstructions(db, 'General')).toContain('emit_enhanced_notes');

    db.exec(v11sql());

    const names = ['General', '1:1', 'Internal sync', 'Sales meeting', 'Sales demo', 'Sales discovery'];
    for (const name of names) {
      const text = builtinInstructions(db, name);
      expect(text).not.toContain('emit_enhanced_notes');
      expect(text).not.toContain('sourceSegmentIds');
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('leaves user-created templates untouched', () => {
    const db = dbAtVersion(10);
    db.exec(
      `INSERT INTO templates (name, instructions, language_mode, is_builtin, created_at, updated_at)
       VALUES ('My Template', 'emit_enhanced_notes verbatim from my own prompt', 'global', 0, 0, 0)`,
    );

    db.exec(v11sql());

    const row = db
      .prepare(`SELECT instructions, updated_at FROM templates WHERE name = 'My Template' AND is_builtin = 0`)
      .get() as { instructions: string; updated_at: number };
    expect(row.instructions).toBe('emit_enhanced_notes verbatim from my own prompt');
    expect(row.updated_at).toBe(0);
  });

  it('preserves a meeting\'s template_id reference to a built-in (UPDATE, not DELETE)', () => {
    const db = dbAtVersion(10);
    const general = db
      .prepare(`SELECT id FROM templates WHERE is_builtin = 1 AND name = 'General'`)
      .get() as { id: number };
    db.exec(
      `INSERT INTO meetings (id, title, status, created_at, template_id)
       VALUES (1, 'Standup', 'ended', 0, ${general.id})`,
    );

    db.exec(v11sql());

    const row = db.prepare(`SELECT template_id FROM meetings WHERE id = 1`).get() as {
      template_id: number | null;
    };
    expect(row.template_id).toBe(general.id);
  });

  it('is idempotent (running the migration twice yields the same instructions)', () => {
    const db = dbAtVersion(10);
    db.exec(v11sql());
    const once = builtinInstructions(db, 'Sales discovery');
    db.exec(v11sql());
    const twice = builtinInstructions(db, 'Sales discovery');
    expect(twice).toBe(once);
  });
});
