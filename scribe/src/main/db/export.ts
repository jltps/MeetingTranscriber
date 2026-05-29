// Export and backup DB layer (ROADMAP_04). Pure DB — no Electron/IPC imports.
// Pattern mirrors db/speakers.ts and db/meetings.ts.
import { getDb } from './index';
import { listFolders, listTags, tagsForMeeting } from './organization';
import { getInsights, saveInsights } from './insights';
import type { BackupBundle, BackupMeeting } from '../../shared/ipc-contract';

// ── Raw SQLite row types ───────────────────────────────────────────────────

type MeetingRow = {
  id: number;
  title: string;
  status: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  template_id: number | null;
  folder_id: number | null;
  stt_provider: string | null;
  deepgram_audio_ms: number;
  deepgram_channels: number;
  claude_input_tokens: number;
  claude_output_tokens: number;
  template_name: string | null;
  raw_user_md: string;
  enhanced_json: string | null;
  enhanced_at: number | null;
  enhanced_lang: string | null;
};

type SegmentRow = {
  id: number;
  channel: number;
  speaker_label: string;
  text: string;
  start_ms: number;
  end_ms: number;
  session_seq: number;
};

type SpeakerRow = { raw_label: string; display_name: string };

type TemplateRow = {
  id: number;
  name: string;
  instructions: string;
  language_mode: string;
  language_code: string | null;
  created_at: number;
  updated_at: number;
};

// ── Query helpers ──────────────────────────────────────────────────────────

const MEETING_SELECT = `
  SELECT
    m.id, m.title, m.status, m.created_at, m.started_at, m.ended_at,
    m.template_id, m.folder_id, m.stt_provider, m.deepgram_audio_ms, m.deepgram_channels, m.claude_input_tokens, m.claude_output_tokens,
    t.name  AS template_name,
    n.raw_user_md, n.enhanced_json, n.enhanced_at, n.enhanced_lang
  FROM meetings m
  LEFT JOIN templates t ON m.template_id = t.id
  LEFT JOIN notes    n ON n.meeting_id   = m.id
`;

function rowToMeeting(row: MeetingRow, meetingId: number): BackupMeeting {
  const db = getDb();
  const segments = db
    .prepare(
      `SELECT id, channel, speaker_label, text, start_ms, end_ms, session_seq
       FROM transcript_segments WHERE meeting_id = ? ORDER BY start_ms`,
    )
    .all(meetingId) as SegmentRow[];

  const speakerNames = db
    .prepare(`SELECT raw_label, display_name FROM speaker_names WHERE meeting_id = ?`)
    .all(meetingId) as SpeakerRow[];

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    templateId: row.template_id,
    folderId: row.folder_id,
    sttProvider: row.stt_provider,
    insights: getInsights(meetingId),
    tags: tagsForMeeting(meetingId),
    rawUserMd: row.raw_user_md ?? '',
    enhancedJson: row.enhanced_json,
    enhancedAt: row.enhanced_at,
    enhancedLang: row.enhanced_lang,
    templateName: row.template_name,
    usage: {
      deepgramAudioMs: row.deepgram_audio_ms,
      deepgramChannels: row.deepgram_channels,
      claudeInputTokens: row.claude_input_tokens,
      claudeOutputTokens: row.claude_output_tokens,
    },
    segments: segments.map((s) => ({
      id: s.id,
      channel: s.channel,
      speakerLabel: s.speaker_label,
      text: s.text,
      startMs: s.start_ms,
      endMs: s.end_ms,
      sessionSeq: s.session_seq ?? 1,
    })),
    speakerNames: speakerNames.map((sn) => ({
      rawLabel: sn.raw_label,
      displayName: sn.display_name,
    })),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all data for a single meeting — for Phase 1 Markdown export.
 * Throws if the meeting is not found.
 */
export function getMeetingExportData(meetingId: number): BackupMeeting {
  const row = getDb()
    .prepare(`${MEETING_SELECT} WHERE m.id = ?`)
    .get(meetingId) as MeetingRow | undefined;
  if (!row) throw new Error(`Meeting ${meetingId} not found`);
  return rowToMeeting(row, meetingId);
}

/**
 * Collect all meetings + user-created templates into a backup bundle.
 * Built-in templates (is_builtin = 1) are excluded — they are recreated
 * by migrations and should not override them on restore.
 * API keys are never included (they live in safeStorage).
 */
export function getAllExportData(): BackupBundle {
  const db = getDb();

  const meetingRows = db
    .prepare(`${MEETING_SELECT} ORDER BY m.created_at`)
    .all() as MeetingRow[];

  const meetings: BackupMeeting[] = meetingRows.map((row) => rowToMeeting(row, row.id));

  const templateRows = db
    .prepare(
      `SELECT id, name, instructions, language_mode, language_code, created_at, updated_at
       FROM templates WHERE is_builtin = 0 ORDER BY created_at`,
    )
    .all() as TemplateRow[];

  const templates = templateRows.map((t) => ({
    id: t.id,
    name: t.name,
    instructions: t.instructions,
    languageMode: t.language_mode,
    languageCode: t.language_code,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }));

  return {
    version: 3,
    app: 'scribe',
    exportedAt: new Date().toISOString(),
    meetings,
    templates,
    folders: listFolders(),
    tags: listTags(),
  };
}

/**
 * Restore all meetings from a validated backup bundle.
 * Strategy:
 *   1. Delete all meetings (CASCADE removes notes, segments, speaker_names).
 *   2. Delete user templates.
 *   3. Re-insert user templates first (meetings may reference them by id).
 *   4. Re-insert meetings, then their notes, segments, speaker_names.
 *      meeting.templateId is set only if the template actually exists (built-in
 *      or just-restored user template); otherwise NULL to avoid FK violations.
 * Returns the count of restored meetings.
 */
export function restoreFromBackup(bundle: BackupBundle): { meetingCount: number } {
  const db = getDb();

  const restore = db.transaction(() => {
    // Defer FK checks to commit so insertion order (self-referencing folders,
    // meetings → folders/templates, meeting_tags) doesn't matter (ROADMAP_V04_04).
    db.pragma('defer_foreign_keys = ON');

    // 1. Wipe meetings (CASCADE removes notes/segments/speaker_names/meeting_tags),
    //    user templates, folders, and tags.
    db.prepare('DELETE FROM meetings').run();
    db.prepare('DELETE FROM templates WHERE is_builtin = 0').run();
    db.prepare('DELETE FROM folders').run();
    db.prepare('DELETE FROM tags').run();

    // 1b. Restore folders + tags (preserve ids). v1 bundles have empty arrays.
    const insertFolder = db.prepare(
      `INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)`,
    );
    for (const f of bundle.folders) insertFolder.run(f.id, f.name, f.parentId, f.createdAt);
    const insertTag = db.prepare(`INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)`);
    for (const tag of bundle.tags) insertTag.run(tag.id, tag.name, tag.createdAt);
    const validFolderIds = new Set(bundle.folders.map((f) => f.id));
    const tagIdByName = new Map(bundle.tags.map((t) => [t.name.toLowerCase(), t.id]));

    // 2. Restore user templates so meetings can reference them.
    const insertTemplate = db.prepare(
      `INSERT OR IGNORE INTO templates
         (id, name, instructions, language_mode, language_code, is_builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    for (const t of bundle.templates) {
      insertTemplate.run(t.id, t.name, t.instructions, t.languageMode, t.languageCode, t.createdAt, t.updatedAt);
    }

    // Build the set of valid template IDs so we can null out dangling references.
    const validTemplateIds = new Set(
      (db.prepare('SELECT id FROM templates').all() as { id: number }[]).map((r) => r.id),
    );

    // 3. Restore meetings + their children.
    const insertMeeting = db.prepare(
      `INSERT INTO meetings
         (id, title, status, created_at, started_at, ended_at, template_id, folder_id, stt_provider,
          deepgram_audio_ms, deepgram_channels, claude_input_tokens, claude_output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMeetingTag = db.prepare(
      `INSERT OR IGNORE INTO meeting_tags (meeting_id, tag_id) VALUES (?, ?)`,
    );
    const insertNotes = db.prepare(
      `INSERT INTO notes (meeting_id, raw_user_md, enhanced_json, enhanced_at, enhanced_lang)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertSegment = db.prepare(
      `INSERT INTO transcript_segments
         (id, meeting_id, channel, speaker_label, text, start_ms, end_ms, session_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSpeaker = db.prepare(
      `INSERT INTO speaker_names (meeting_id, raw_label, display_name) VALUES (?, ?, ?)`,
    );

    for (const m of bundle.meetings) {
      const templateId =
        m.templateId !== null && validTemplateIds.has(m.templateId) ? m.templateId : null;
      const folderId = m.folderId !== null && validFolderIds.has(m.folderId) ? m.folderId : null;
      insertMeeting.run(
        m.id, m.title, m.status, m.createdAt, m.startedAt, m.endedAt, templateId, folderId, m.sttProvider ?? null,
        m.usage.deepgramAudioMs, m.usage.deepgramChannels, m.usage.claudeInputTokens, m.usage.claudeOutputTokens,
      );
      insertNotes.run(m.id, m.rawUserMd, m.enhancedJson, m.enhancedAt, m.enhancedLang);
      // V08: restore post-call insights when present + finished. Session ids are
      // not preserved (the live sessions are long gone).
      if (m.insights && m.insights.status === 'ready') saveInsights(m.id, m.insights, []);
      for (const seg of m.segments) {
        insertSegment.run(seg.id, m.id, seg.channel, seg.speakerLabel, seg.text, seg.startMs, seg.endMs, seg.sessionSeq);
      }
      for (const sn of m.speakerNames) {
        insertSpeaker.run(m.id, sn.rawLabel, sn.displayName);
      }
      for (const tagName of m.tags) {
        const tagId = tagIdByName.get(tagName.toLowerCase());
        if (tagId !== undefined) insertMeetingTag.run(m.id, tagId);
      }
    }
  });

  restore();
  return { meetingCount: bundle.meetings.length };
}
