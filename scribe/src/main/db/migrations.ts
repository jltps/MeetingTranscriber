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
  {
    version: 4,
    name: 'replace-builtin-templates',
    sql: `
      -- Remove all old built-in templates (meetings referencing them get template_id = NULL via FK ON DELETE SET NULL)
      DELETE FROM templates WHERE is_builtin = 1;

      -- Insert 6 new built-in starter templates
      INSERT INTO templates (name, instructions, language_mode, is_builtin, created_at, updated_at) VALUES
      (
        'General',
        '',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      ),
      (
        'Sales discovery',
        'Structure notes around customer needs and qualification. Highlight: (1) customer background and current situation, (2) pain points and business challenges, (3) desired outcomes and success metrics, (4) budget, decision timeline, and stakeholders (BANT), (5) objections or concerns raised, (6) agreed next steps with owners and dates. Flag open questions that need follow-up.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      ),
      (
        'Sales meeting',
        'Structure notes around deal progression. Highlight: (1) meeting objective and attendees, (2) opportunity status update, (3) key discussion points and customer feedback, (4) objections raised and how they were addressed, (5) product, pricing, or contract topics discussed, (6) commitments made by both sides, (7) next steps with owners and dates. Note any changes in deal status or urgency.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      ),
      (
        'Sales demo',
        'Structure notes around the product demonstration. Highlight: (1) demo context and audience background, (2) use cases and scenarios shown, (3) prospect reactions, questions, and comments during the demo, (4) features that resonated most and least, (5) objections or gaps identified, (6) follow-up items and next steps. Capture verbatim any strong positive or negative reactions to specific features.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      ),
      (
        'Internal sync',
        'Keep notes concise and focused on outcomes. Highlight: (1) agenda items covered, (2) status updates per workstream or team member, (3) blockers, risks, or escalations flagged, (4) decisions made and rationale, (5) action items with clear owners and due dates. Skip discussion context — focus on what was decided and what happens next.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      ),
      (
        '1:1',
        'Structure notes to support ongoing manager–report relationship. Highlight: (1) progress on goals and commitments from last meeting, (2) wins and achievements to acknowledge, (3) current blockers and what support is needed, (4) feedback shared in both directions, (5) updated goals and priorities for the next period, (6) career development or personal topics. Capture specific commitments from both sides.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      );
    `,
  },
  {
    version: 5,
    name: 'templates-as-full-prompts',
    sql: `
      -- Replace the short addendum-style instructions with full self-contained prompts.
      -- Users can now read and edit the actual text that reaches the LLM.
      -- Meetings referencing these templates are unaffected (template_id stays valid).
      DELETE FROM templates WHERE is_builtin = 1;

      INSERT INTO templates (name, instructions, language_mode, is_builtin, created_at, updated_at) VALUES
      (
        'General',
        'You enhance a user''s rough meeting notes using the meeting transcript. You return the result by calling the emit_enhanced_notes tool.

Rules:
- PRESERVE the user''s notes. Never delete, contradict, or silently rewrite the user''s points. Expand and structure them. Emit each user point as a block with origin "user".
- ADD structure and detail drawn from the transcript: headings, key points, decisions, and concrete action items. These added blocks have origin "ai".
- Draw specifics (names, numbers, decisions, quotes) from the transcript for "ai" blocks. Do not invent facts not in the notes or transcript.
- For each "ai" block, set sourceSegmentIds to the [id=N] transcript markers it was derived from. Use an empty array for "user" blocks.
- Block types: "heading", "paragraph", "bullet", "action_item". Use "action_item" for concrete tasks/todos.
- Order blocks to read naturally: a heading, then the relevant points beneath it.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      ),
      (
        'Sales discovery',
        'You enhance a user''s rough notes from a sales discovery call using the meeting transcript. You return the result by calling the emit_enhanced_notes tool.

Rules:
- PRESERVE the user''s notes. Never delete, contradict, or silently rewrite the user''s points. Expand and structure them. Emit each user point as a block with origin "user".
- ADD structure and detail drawn from the transcript. These blocks have origin "ai". Structure notes around customer qualification: (1) customer background and current situation, (2) pain points and business challenges, (3) desired outcomes and success metrics, (4) budget, decision timeline, and stakeholders (BANT), (5) objections or concerns raised, (6) agreed next steps with owners and dates. Flag open questions that need follow-up.
- Draw specifics (names, numbers, decisions, quotes) from the transcript for "ai" blocks. Do not invent facts not in the notes or transcript.
- For each "ai" block, set sourceSegmentIds to the [id=N] transcript markers it was derived from. Use an empty array for "user" blocks.
- Block types: "heading", "paragraph", "bullet", "action_item". Use "action_item" for concrete tasks with owners and dates.
- Order blocks to read naturally: a heading, then the relevant points beneath it.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      ),
      (
        'Sales meeting',
        'You enhance a user''s rough notes from a sales meeting using the meeting transcript. You return the result by calling the emit_enhanced_notes tool.

Rules:
- PRESERVE the user''s notes. Never delete, contradict, or silently rewrite the user''s points. Expand and structure them. Emit each user point as a block with origin "user".
- ADD structure and detail drawn from the transcript. These blocks have origin "ai". Structure notes around deal progression: (1) meeting objective and attendees, (2) opportunity status update, (3) key discussion points and customer feedback, (4) objections raised and how they were addressed, (5) product, pricing, or contract topics discussed, (6) commitments made by both sides, (7) next steps with owners and dates. Note any changes in deal status or urgency.
- Draw specifics (names, numbers, decisions, quotes) from the transcript for "ai" blocks. Do not invent facts not in the notes or transcript.
- For each "ai" block, set sourceSegmentIds to the [id=N] transcript markers it was derived from. Use an empty array for "user" blocks.
- Block types: "heading", "paragraph", "bullet", "action_item". Use "action_item" for concrete tasks with owners and dates.
- Order blocks to read naturally: a heading, then the relevant points beneath it.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      ),
      (
        'Sales demo',
        'You enhance a user''s rough notes from a product demo using the meeting transcript. You return the result by calling the emit_enhanced_notes tool.

Rules:
- PRESERVE the user''s notes. Never delete, contradict, or silently rewrite the user''s points. Expand and structure them. Emit each user point as a block with origin "user".
- ADD structure and detail drawn from the transcript. These blocks have origin "ai". Structure notes around the demonstration: (1) demo context and audience background, (2) use cases and scenarios shown, (3) prospect reactions, questions, and comments during the demo, (4) features that resonated most and least, (5) objections or gaps identified, (6) follow-up items and next steps. Capture verbatim any strong positive or negative reactions to specific features.
- Draw specifics (names, numbers, decisions, quotes) from the transcript for "ai" blocks. Do not invent facts not in the notes or transcript.
- For each "ai" block, set sourceSegmentIds to the [id=N] transcript markers it was derived from. Use an empty array for "user" blocks.
- Block types: "heading", "paragraph", "bullet", "action_item". Use "action_item" for concrete tasks with owners and dates.
- Order blocks to read naturally: a heading, then the relevant points beneath it.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      ),
      (
        'Internal sync',
        'You enhance a user''s rough notes from an internal team meeting using the meeting transcript. You return the result by calling the emit_enhanced_notes tool.

Rules:
- PRESERVE the user''s notes. Never delete, contradict, or silently rewrite the user''s points. Expand and structure them. Emit each user point as a block with origin "user".
- ADD structure and detail drawn from the transcript. These blocks have origin "ai". Keep notes concise and outcome-focused: (1) agenda items covered, (2) status updates per workstream or team member, (3) blockers, risks, or escalations flagged, (4) decisions made and rationale, (5) action items with clear owners and due dates. Skip discussion context — focus on what was decided and what happens next.
- Draw specifics (names, numbers, decisions, quotes) from the transcript for "ai" blocks. Do not invent facts not in the notes or transcript.
- For each "ai" block, set sourceSegmentIds to the [id=N] transcript markers it was derived from. Use an empty array for "user" blocks.
- Block types: "heading", "paragraph", "bullet", "action_item". Use "action_item" for concrete tasks with owners and dates.
- Order blocks to read naturally: a heading, then the relevant points beneath it.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      ),
      (
        '1:1',
        'You enhance a user''s rough notes from a 1:1 meeting using the meeting transcript. You return the result by calling the emit_enhanced_notes tool.

Rules:
- PRESERVE the user''s notes. Never delete, contradict, or silently rewrite the user''s points. Expand and structure them. Emit each user point as a block with origin "user".
- ADD structure and detail drawn from the transcript. These blocks have origin "ai". Structure notes to support the manager–report relationship: (1) progress on goals and commitments from last meeting, (2) wins and achievements to acknowledge, (3) current blockers and what support is needed, (4) feedback shared in both directions, (5) updated goals and priorities for the next period, (6) career development or personal topics discussed. Capture specific commitments from both sides.
- Draw specifics (names, numbers, decisions, quotes) from the transcript for "ai" blocks. Do not invent facts not in the notes or transcript.
- For each "ai" block, set sourceSegmentIds to the [id=N] transcript markers it was derived from. Use an empty array for "user" blocks.
- Block types: "heading", "paragraph", "bullet", "action_item". Use "action_item" for concrete tasks with owners and dates.
- Order blocks to read naturally: a heading, then the relevant points beneath it.',
        'global', 1, unixepoch('now')*1000, unixepoch('now')*1000
      );
    `,
  },
  {
    version: 6,
    name: 'usage-tracking',
    // Per-meeting usage columns for cost visibility (ROADMAP_01 §3).
    // Additive ALTER TABLEs — existing rows default to 0 (no cost recorded).
    // deepgram_audio_ms: total captured audio in milliseconds (both channels).
    // claude_input/output_tokens: tokens consumed by the Anthropic enhancement call.
    sql: `
      ALTER TABLE meetings ADD COLUMN deepgram_audio_ms    INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE meetings ADD COLUMN claude_input_tokens  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE meetings ADD COLUMN claude_output_tokens INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 7,
    name: 'speaker-names',
    // Per-meeting speaker name mapping (ROADMAP_02).
    // Naming is metadata — the raw speaker_label in transcript_segments is never
    // edited for renames; this table stores the display name overlay.
    // ON DELETE CASCADE: when a meeting is deleted, its name mappings go too.
    sql: `
      CREATE TABLE speaker_names (
        id           INTEGER PRIMARY KEY,
        meeting_id   INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        raw_label    TEXT    NOT NULL,
        display_name TEXT    NOT NULL,
        UNIQUE(meeting_id, raw_label)
      );
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
