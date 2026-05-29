// Numbered, forward-only migrations (CLAUDE.md §7). The schema version lives in
// SQLite's PRAGMA user_version; each migration runs once inside a transaction.
// Migration 1 is the PRODUCT_SPEC.md §11 baseline. There is intentionally no
// audio table — audio is never persisted (§1.1).
import type { Database } from 'better-sqlite3';

export type Migration = { version: number; name: string; sql: string };

// Exported so migration logic can be exercised in unit tests against a throwaway
// SQLite database (CLAUDE.md §9 — test migrations against a populated DB).
export const MIGRATIONS: Migration[] = [
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
  {
    version: 8,
    name: 'calendar',
    // Calendar integration (ROADMAP_06). Read-only cache of upcoming events from
    // connected providers + a nullable link from a meeting to the event it was
    // started from. No audio/no tokens here — tokens live in `settings` (encrypted).
    sql: `
      CREATE TABLE calendar_events (
        id             INTEGER PRIMARY KEY,
        provider_id    TEXT    NOT NULL,            -- 'google' | 'microsoft'
        external_id    TEXT    NOT NULL,            -- provider event id (singleEvents instance)
        title          TEXT    NOT NULL DEFAULT '',
        start_ms       INTEGER NOT NULL,
        end_ms         INTEGER NOT NULL,
        all_day        INTEGER NOT NULL DEFAULT 0,
        join_url       TEXT,
        attendees_json TEXT    NOT NULL DEFAULT '[]',
        armed          INTEGER NOT NULL DEFAULT 0,  -- user opted into auto-start
        synced_at      INTEGER NOT NULL,
        UNIQUE(provider_id, external_id)
      );
      CREATE INDEX idx_calendar_events_start ON calendar_events(start_ms);

      -- ON DELETE SET NULL: deleting/re-syncing an event must NOT delete the
      -- meeting it spawned (CLAUDE.md §7). Mirrors templates' ON DELETE SET NULL.
      ALTER TABLE meetings ADD COLUMN calendar_event_id INTEGER
        REFERENCES calendar_events(id) ON DELETE SET NULL;
    `,
  },
  {
    version: 9,
    name: 'folders-and-tags',
    // Note organization (ROADMAP_V04_04). Additive. Folders nest (parent cascades to
    // subfolders), but deleting a folder must NOT delete meetings — meetings.folder_id
    // is ON DELETE SET NULL (CLAUDE.md §7, like templates/calendar). Tags are a flat,
    // case-insensitive-unique namespace joined many-to-many via meeting_tags.
    sql: `
      CREATE TABLE folders (
        id         INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL,
        parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        UNIQUE(parent_id, name)
      );
      CREATE INDEX idx_folders_parent ON folders(parent_id);
      -- UNIQUE(parent_id, name) doesn't dedupe roots (SQLite treats NULL parent_id as
      -- distinct), so enforce unique top-level names with a partial index.
      CREATE UNIQUE INDEX idx_folders_root_name ON folders(name) WHERE parent_id IS NULL;

      ALTER TABLE meetings ADD COLUMN folder_id INTEGER
        REFERENCES folders(id) ON DELETE SET NULL;
      CREATE INDEX idx_meetings_folder ON meetings(folder_id);

      CREATE TABLE tags (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE meeting_tags (
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        tag_id     INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
        PRIMARY KEY (meeting_id, tag_id)
      );
      CREATE INDEX idx_meeting_tags_tag ON meeting_tags(tag_id);

      -- "Updated" sort key. Legacy rows stay NULL and fall back to created_at in queries.
      ALTER TABLE meetings ADD COLUMN updated_at INTEGER;
    `,
  },
  {
    version: 10,
    name: 'deepgram-billed-channels',
    // Per-meeting billed Deepgram channel count for accurate cost (V05 ROADMAP_02).
    // Deepgram bills per channel; the app used to capture 2 channels and now captures
    // 1 (mono) to halve cost. Existing rows were 2-channel, so default 2 keeps their
    // historical cost correct; new meetings record the channel count they used.
    sql: `
      ALTER TABLE meetings ADD COLUMN deepgram_channels INTEGER NOT NULL DEFAULT 2;
    `,
  },
  {
    version: 11,
    name: 'templates-guidance-only-reseed',
    // V06 block 01. The v4/v5 seeds stored the FULL system prompt (tool use,
    // sourceSegmentIds, block-type mechanics) in `instructions`, leaking app scaffolding
    // into the template editor. Those mechanics now live in buildSystemPrompt's always-on
    // SCAFFOLD_SECTION; `instructions` is a guidance-only slot
    // (roadmap/V06/MEETING_TEMPLATES.md). Reseed the built-ins with that clean text.
    // UPDATE in place (not DELETE+INSERT) so meetings.template_id references survive — a
    // DELETE would null them via ON DELETE SET NULL on real user meetings (§7). Matches on
    // (is_builtin, name); a built-in the user deleted or renamed is intentionally left
    // untouched. Single quotes in the text are doubled per SQL string rules. Idempotent.
    sql: `
      UPDATE templates SET
        instructions = 'You are enhancing notes for a general business meeting. Expand the user''s rough notes into a clear, skimmable summary grounded strictly in the transcript and their notes. Produce these sections, omitting any with no support (mark "Not discussed"):
- Summary: 2-4 sentences on the meeting''s purpose and the headline outcome.
- Key discussion points: the main topics, each with the substance of what was said and any context needed to understand it later.
- Decisions: every decision actually made, stated unambiguously. If something was debated but not decided, put it under Open questions instead.
- Action items: concrete next steps as action_item blocks, each with an owner and a due date when stated or clearly implied. Only include real commitments, not vague intentions.
- Open questions / follow-ups: unresolved items, things to confirm, or topics deferred to a later meeting.
Use the participants'' real names where known. Keep it concise and factual; do not editorialize or add advice that wasn''t discussed.',
        updated_at = unixepoch('now')*1000
      WHERE is_builtin = 1 AND name = 'General';

      UPDATE templates SET
        instructions = 'You are enhancing notes for a manager/direct-report 1:1. The goal is a private, trust-building development conversation, not a status report. Organize the summary around the person''s experience and growth, grounded strictly in the transcript and notes. Produce these sections, marking any unsupported one "Not discussed":
- Check-in: how the person is doing (workload, morale, energy) if mentioned.
- Priorities & progress: what they''re focused on and progress since last time, including wins worth recognizing.
- Blockers & support needed: obstacles raised and what help was requested or offered.
- Feedback exchanged: feedback in BOTH directions (manager to report and report to manager), kept specific to behaviors and outcomes, not personal traits.
- Development & career: any discussion of growth goals, skills, career path, or learning.
- Action items: commitments from BOTH people, as action_item blocks with owner and due date when stated. Attribute clearly who owns each (manager vs report).
- For next time: topics to revisit or carry forward.
Keep the tone supportive and confidential. Capture sensitive or personal context factually and discreetly; never speculate about performance or motivations beyond what was said.',
        updated_at = unixepoch('now')*1000
      WHERE is_builtin = 1 AND name = '1:1';

      UPDATE templates SET
        instructions = 'You are enhancing notes for an internal team/project sync. The purpose is alignment: progress, blockers, decisions, and clear ownership. Ground everything strictly in the transcript and notes. Produce these sections, marking any unsupported one "Not discussed":
- Summary: 1-3 sentences on overall status and anything notable this cycle.
- Progress updates: what''s done and what''s in progress, grouped by workstream, project, or person as the conversation allows.
- Blockers & risks: obstacles, dependencies, and risks raised. Each blocker that needs resolution should also appear as an action item with an owner.
- Decisions: decisions made during the sync, stated clearly.
- Action items: next steps as action_item blocks in who-owns-it / what / by-when form, with owner and due date whenever stated or implied. Be selective: only items that genuinely move work forward, not every passing comment.
- Dependencies & handoffs: cross-person or cross-team handoffs and who is waiting on whom.
Use real names. Keep updates tight; do not pad. Flag anything explicitly called urgent or at-risk.',
        updated_at = unixepoch('now')*1000
      WHERE is_builtin = 1 AND name = 'Internal sync';

      UPDATE templates SET
        instructions = 'You are enhancing notes for an external sales meeting (not a formal discovery call or demo). Capture what advances the deal, grounded strictly in the transcript and notes. Produce these sections, marking any unsupported one "Not discussed":
- Summary: 2-4 sentences on who met, the meeting''s purpose, and the headline outcome for the deal.
- Attendees & roles: people present and their role/title where known, especially decision-makers, champions, or new stakeholders.
- Customer priorities & needs: the business problems, goals, and priorities the customer expressed, in their own words where possible.
- Discussion & topics covered: products, proposals, pricing, scope, or timeline discussed.
- Objections & concerns: any pushback, risk, or hesitation raised, and how it was addressed.
- Commitments & agreements: what each side agreed to or committed to.
- Next steps: action_item blocks with owner (ours vs customer) and a date for each. Capture any mutually-agreed timeline or "critical event" / deadline that creates urgency.
Be precise with numbers, dates, names, and commitments; never invent them. Keep a neutral, factual tone.',
        updated_at = unixepoch('now')*1000
      WHERE is_builtin = 1 AND name = 'Sales meeting';

      UPDATE templates SET
        instructions = 'You are enhancing notes for a product sales demo. The frame is: which customer problems were shown to be solved, how the audience reacted, and what happens next, not a list of features. Ground everything strictly in the transcript and notes. Produce these sections, marking any unsupported one "Not discussed":
- Summary: 2-4 sentences on what was demoed, to whom, and the overall reception.
- Attendees & roles: who attended and their roles, flagging decision-makers, technical evaluators, and any new stakeholders vs prior calls.
- Use cases / pains addressed: the customer problems or goals the demo targeted, ideally in the customer''s own words.
- What was shown & how it mapped to their needs: capabilities demonstrated, each connected to the specific pain or outcome it addressed. Note features that landed especially well.
- Reactions & engagement: positive signals, moments of interest, and any lukewarm or negative reactions.
- Questions & objections: questions asked and concerns/objections raised (functional and technical), with how each was answered and any left open.
- Gaps & follow-ups: requested capabilities not shown, items to follow up on, or things to confirm (e.g. a technical validation, security review).
- Next steps: action_item blocks with owner and date: the agreed next action, who needs to be looped in next (e.g. economic buyer, other evaluators), and any timeline/critical event mentioned.
Be accurate about what was actually demonstrated and how people responded; do not overstate enthusiasm or invent commitments.',
        updated_at = unixepoch('now')*1000
      WHERE is_builtin = 1 AND name = 'Sales demo';

      UPDATE templates SET
        instructions = 'You are enhancing notes for a sales discovery call. The job of the notes is qualification: surface the prospect''s situation, pain, and the information needed to judge and advance the opportunity. Ground everything strictly in the transcript and notes; discovery notes that invent detail are worse than useless. Produce these sections, marking any genuinely uncovered-but-unanswered area "Not yet known" and any untouched area "Not discussed":
- Summary: 2-4 sentences on who we spoke with, their context, and the headline takeaway on fit and opportunity.
- Attendees & roles: people present, titles, and apparent influence (user, champion, decision-maker, economic buyer) where discernible.
- Situation: the prospect''s current state (environment, tools, team, relevant context).
- Pain & challenges: the problems and their root causes, in the prospect''s own words where possible.
- Impact: the quantified or qualitative cost of those problems (time, money, risk, missed goals); what it''s costing them to not solve this.
- Desired outcome / success criteria: what a good solution looks like to them and how they''d measure success.
- Decision process & criteria: how they buy (who''s involved, the steps, evaluation criteria, and any procurement/paper process or approvals mentioned).
- Economic buyer & champion: who controls budget, and who internally is advocating for change.
- Competition & alternatives: other vendors, internal builds, or doing nothing.
- Timeline / critical event: any deadline or compelling event creating urgency.
- Risks & open questions: gaps, red flags, and what still needs to be learned.
- Next steps: action_item blocks with owner and date, including who else needs to be brought into the next conversation.
Distinguish clearly between what the prospect actually said and what remains unknown. Do not fabricate budget, authority, timelines, or names. A precise "we don''t know X yet" is a valid and valuable output.',
        updated_at = unixepoch('now')*1000
      WHERE is_builtin = 1 AND name = 'Sales discovery';
    `,
  },
  {
    version: 12,
    name: 'meeting-sort-overrides',
    // V072 block 04. Per-sort-mode manual reorder of the sidebar meeting list.
    // Drag-reorder writes a fractional `position` between neighbours so most
    // drags don't need a renumber. Rows without an override fall back to the
    // mode's natural rank (created_at DESC for Recent, LOWER(title) for A-Z,
    // etc.). Cascade on meeting delete keeps the table from drifting.
    sql: `
      CREATE TABLE meeting_sort_overrides (
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        sort_mode  TEXT    NOT NULL,
        position   REAL    NOT NULL,
        PRIMARY KEY (meeting_id, sort_mode)
      );
      CREATE INDEX idx_meeting_sort_overrides_mode_pos
        ON meeting_sort_overrides (sort_mode, position);
    `,
  },
  {
    version: 13,
    name: 'transcript-segment-spans',
    // V075 ROADMAP_02 + ROADMAP_03. Two additive nullable JSON columns on
    // transcript_segments:
    //   - paragraph_breaks_json: ascending int[] of character offsets where
    //     Deepgram's paragraph boundaries land within a single-speaker segment
    //     (block 02).
    //   - word_spans_json: { start, end, isFiller }[] character offsets used
    //     by the renderer to render filler tokens with subdued styling
    //     (block 03).
    // Both NULLable; existing rows stay readable and render as before.
    sql: `
      ALTER TABLE transcript_segments ADD COLUMN paragraph_breaks_json TEXT;
      ALTER TABLE transcript_segments ADD COLUMN word_spans_json       TEXT;
    `,
  },
  {
    version: 14,
    name: 'gladia-insights',
    // V08 — Gladia provider's post-call audio intelligence (diarization + NER +
    // sentiment). One additive table for the normalized, per-meeting insights and
    // one additive column to remember which STT provider a meeting used (so cost
    // estimation can price each meeting at the right rate; NULL = legacy/deepgram).
    //   - status: 'processing' (job running) | 'ready' (insights_json populated) | 'error'
    //   - insights_json: normalized MeetingInsights (utterances + summary); NULL until ready
    //   - session_ids_json: Gladia live session id(s) — multiple across a 3h handoff —
    //     used to merge sub-sessions and to resume the fetch after an app restart.
    // Both NULLable; existing meetings stay readable and simply show no Insights.
    sql: `
      CREATE TABLE meeting_insights (
        meeting_id       INTEGER PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
        provider         TEXT    NOT NULL,
        status           TEXT    NOT NULL,
        insights_json    TEXT,
        session_ids_json TEXT,
        error            TEXT,
        updated_at       INTEGER NOT NULL
      );
      ALTER TABLE meetings ADD COLUMN stt_provider TEXT;
    `,
  },
  {
    version: 15,
    name: 'transcript-session-seq',
    // V081 — recording a 2nd time into a meeting appends a new "session". Each
    // segment records which recording session produced it so the renderer can
    // show a "Session N" divider and the IPC layer can offset new sessions past
    // the existing transcript. Additive, defaults 1 so existing rows read as the
    // first session.
    sql: `
      ALTER TABLE transcript_segments ADD COLUMN session_seq INTEGER NOT NULL DEFAULT 1;
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
