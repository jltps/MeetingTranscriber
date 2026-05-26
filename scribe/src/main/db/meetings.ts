import { getDb } from './index';
import type {
  MeetingDetail,
  MeetingStatus,
  MeetingSummary,
  PersistedSegment,
  TranscriptSegment,
} from '../../shared/types';
import type { EnhancerSegment } from '../enhancer/enhancer';

// All meeting/notes/transcript persistence (PRODUCT_SPEC.md §11). better-sqlite3
// is synchronous and main-process only. The FTS index (search_fts) is rebuilt for
// a meeting whenever its searchable content changes — title + notes + transcript.

type MeetingRow = {
  id: number;
  title: string;
  status: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  template_id: number | null;
};

type SegmentRow = {
  channel: number;
  speaker_label: string;
  text: string;
  start_ms: number;
  end_ms: number;
};

function toSummary(row: MeetingRow): MeetingSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as MeetingStatus,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    templateId: row.template_id,
  };
}

const SUMMARY_COLUMNS = 'id, title, status, created_at, started_at, ended_at, template_id';

function getSummary(id: number): MeetingSummary {
  const row = getDb()
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM meetings WHERE id = ?`)
    .get(id) as MeetingRow | undefined;
  if (!row) throw new Error(`Meeting ${id} not found`);
  return toSummary(row);
}

export function createMeeting(): MeetingSummary {
  const db = getDb();
  const createdAt = Date.now();
  const info = db
    .prepare(`INSERT INTO meetings (title, status, created_at) VALUES (?, 'draft', ?)`)
    .run('Untitled meeting', createdAt);
  const id = Number(info.lastInsertRowid);
  db.prepare(`INSERT INTO notes (meeting_id, raw_user_md) VALUES (?, '')`).run(id);
  rebuildMeetingFts(id);
  return { id, title: 'Untitled meeting', status: 'draft', createdAt, startedAt: null, endedAt: null, templateId: null };
}

export function listMeetings(): MeetingSummary[] {
  const rows = getDb()
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM meetings ORDER BY created_at DESC`)
    .all() as MeetingRow[];
  return rows.map(toSummary);
}

export function getMeeting(id: number): MeetingDetail | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM meetings WHERE id = ?`)
    .get(id) as MeetingRow | undefined;
  if (!row) return null;
  const note = db
    .prepare(`SELECT raw_user_md, enhanced_json, enhanced_lang FROM notes WHERE meeting_id = ?`)
    .get(id) as { raw_user_md: string; enhanced_json: string | null; enhanced_lang: string | null } | undefined;
  return {
    ...toSummary(row),
    rawUserMd: note?.raw_user_md ?? '',
    enhancedJson: note?.enhanced_json ?? null,
    templateId: row.template_id,
    enhancedLang: note?.enhanced_lang ?? null,
  };
}

/** Link a meeting to a template (or clear the link by passing null). */
export function setMeetingTemplate(meetingId: number, templateId: number | null): void {
  getDb()
    .prepare(`UPDATE meetings SET template_id = ? WHERE id = ?`)
    .run(templateId, meetingId);
}

export function saveNotes(id: number, markdown: string): void {
  getDb()
    .prepare(
      `INSERT INTO notes (meeting_id, raw_user_md) VALUES (?, ?)
       ON CONFLICT(meeting_id) DO UPDATE SET raw_user_md = excluded.raw_user_md`,
    )
    .run(id, markdown);
  rebuildMeetingFts(id);
}

export function updateTitle(id: number, title: string): void {
  getDb().prepare(`UPDATE meetings SET title = ? WHERE id = ?`).run(title, id);
  rebuildMeetingFts(id);
}

export function startMeeting(id: number): MeetingSummary {
  getDb()
    .prepare(`UPDATE meetings SET status = 'transcribing', started_at = ? WHERE id = ?`)
    .run(Date.now(), id);
  return getSummary(id);
}

export function endMeeting(id: number): MeetingSummary {
  getDb()
    .prepare(`UPDATE meetings SET status = 'ended', ended_at = ? WHERE id = ?`)
    .run(Date.now(), id);
  rebuildMeetingFts(id);
  return getSummary(id);
}

export function deleteMeeting(id: number): void {
  const db = getDb();
  // meetings children cascade via FK; search_fts is a separate table, clear it too.
  db.prepare(`DELETE FROM meetings WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM search_fts WHERE rowid = ?`).run(id);
}

export function insertTranscriptSegment(meetingId: number, seg: TranscriptSegment): void {
  getDb()
    .prepare(
      `INSERT INTO transcript_segments (meeting_id, channel, speaker_label, text, start_ms, end_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      meetingId,
      seg.channel,
      seg.speakerLabel,
      seg.text,
      Math.round(seg.startMs),
      Math.round(seg.endMs),
    );
}

/**
 * Persist the enhanced notes JSON. Optionally records the language they were
 * written in for display purposes (FEATURES §A2, §C).
 */
export function saveEnhancedNotes(
  id: number,
  enhancedJson: string,
  enhancedLang: string | null = null,
): void {
  getDb()
    .prepare(
      `UPDATE notes SET enhanced_json = ?, enhanced_at = ?, enhanced_lang = ? WHERE meeting_id = ?`,
    )
    .run(enhancedJson, Date.now(), enhancedLang, id);
}

export function getEnhancerSegments(meetingId: number): EnhancerSegment[] {
  const rows = getDb()
    .prepare(
      `SELECT id, channel, speaker_label, text, start_ms, end_ms
       FROM transcript_segments WHERE meeting_id = ? ORDER BY start_ms, id`,
    )
    .all(meetingId) as Array<SegmentRow & { id: number }>;
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel === 0 ? 0 : 1,
    speakerLabel: r.speaker_label,
    text: r.text,
    startMs: r.start_ms,
    endMs: r.end_ms,
  }));
}

export function getTranscript(meetingId: number): PersistedSegment[] {
  const rows = getDb()
    .prepare(
      `SELECT id, channel, speaker_label, text, start_ms, end_ms
       FROM transcript_segments WHERE meeting_id = ? ORDER BY start_ms, id`,
    )
    .all(meetingId) as Array<SegmentRow & { id: number }>;
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    channel: r.channel === 0 ? 0 : 1,
    speakerLabel: r.speaker_label,
    startMs: r.start_ms,
    endMs: r.end_ms,
    isFinal: true,
  }));
}

export function searchMeetings(query: string): MeetingSummary[] {
  const match = toFtsMatch(query);
  if (!match) return [];
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.title, m.status, m.created_at, m.started_at, m.ended_at
       FROM search_fts f JOIN meetings m ON m.id = f.rowid
       WHERE search_fts MATCH ? ORDER BY rank`,
    )
    .all(match) as MeetingRow[];
  return rows.map(toSummary);
}

// Rebuild the single FTS row for a meeting (rowid = meeting id) from its current
// title + notes + transcript. Cheap at our scale and avoids per-segment churn;
// transcript becomes searchable on notes save and when the meeting ends.
export function rebuildMeetingFts(id: number): void {
  const db = getDb();
  const meeting = db.prepare(`SELECT title FROM meetings WHERE id = ?`).get(id) as
    | { title: string }
    | undefined;
  if (!meeting) return;
  const note = db.prepare(`SELECT raw_user_md FROM notes WHERE meeting_id = ?`).get(id) as
    | { raw_user_md: string }
    | undefined;
  const transcript = db
    .prepare(`SELECT group_concat(text, ' ') AS content FROM transcript_segments WHERE meeting_id = ?`)
    .get(id) as { content: string | null } | undefined;
  const content = `${meeting.title} ${note?.raw_user_md ?? ''} ${transcript?.content ?? ''}`.trim();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM search_fts WHERE rowid = ?`).run(id);
    db.prepare(`INSERT INTO search_fts (rowid, meeting_id, content) VALUES (?, ?, ?)`).run(
      id,
      id,
      content,
    );
  });
  tx();
}

// Turn arbitrary user text into a safe FTS5 prefix query (avoids MATCH syntax
// errors from punctuation): each token becomes a prefix term, AND-ed together.
function toFtsMatch(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (terms.length === 0) return '';
  return terms.map((t) => `${t}*`).join(' ');
}
