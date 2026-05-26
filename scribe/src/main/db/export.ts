// Export and backup DB layer (ROADMAP_04). Pure DB — no Electron/IPC imports.
// Pattern mirrors db/speakers.ts and db/meetings.ts.
import { getDb } from './index';
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
  deepgram_audio_ms: number;
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
    m.template_id, m.deepgram_audio_ms, m.claude_input_tokens, m.claude_output_tokens,
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
      `SELECT id, channel, speaker_label, text, start_ms, end_ms
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
    rawUserMd: row.raw_user_md ?? '',
    enhancedJson: row.enhanced_json,
    enhancedAt: row.enhanced_at,
    enhancedLang: row.enhanced_lang,
    templateName: row.template_name,
    usage: {
      deepgramAudioMs: row.deepgram_audio_ms,
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
    version: 1,
    app: 'scribe',
    exportedAt: new Date().toISOString(),
    meetings,
    templates,
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
    // 1. Wipe meetings (CASCADE) + user templates.
    db.prepare('DELETE FROM meetings').run();
    db.prepare('DELETE FROM templates WHERE is_builtin = 0').run();

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
         (id, title, status, created_at, started_at, ended_at, template_id,
          deepgram_audio_ms, claude_input_tokens, claude_output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertNotes = db.prepare(
      `INSERT INTO notes (meeting_id, raw_user_md, enhanced_json, enhanced_at, enhanced_lang)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertSegment = db.prepare(
      `INSERT INTO transcript_segments
         (id, meeting_id, channel, speaker_label, text, start_ms, end_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSpeaker = db.prepare(
      `INSERT INTO speaker_names (meeting_id, raw_label, display_name) VALUES (?, ?, ?)`,
    );

    for (const m of bundle.meetings) {
      const templateId =
        m.templateId !== null && validTemplateIds.has(m.templateId) ? m.templateId : null;
      insertMeeting.run(
        m.id, m.title, m.status, m.createdAt, m.startedAt, m.endedAt, templateId,
        m.usage.deepgramAudioMs, m.usage.claudeInputTokens, m.usage.claudeOutputTokens,
      );
      insertNotes.run(m.id, m.rawUserMd, m.enhancedJson, m.enhancedAt, m.enhancedLang);
      for (const seg of m.segments) {
        insertSegment.run(seg.id, m.id, seg.channel, seg.speakerLabel, seg.text, seg.startMs, seg.endMs);
      }
      for (const sn of m.speakerNames) {
        insertSpeaker.run(m.id, sn.rawLabel, sn.displayName);
      }
    }
  });

  restore();
  return { meetingCount: bundle.meetings.length };
}
