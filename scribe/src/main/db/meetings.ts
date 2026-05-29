import { getDb } from './index';
import type {
  MeetingDetail,
  MeetingStatus,
  MeetingSummary,
  MeetingUsage,
  PersistedSegment,
  TranscriptSegment,
} from '../../shared/types';
import type { UsageTotals } from '../../shared/ipc-contract';
import { estimateCost, PRICING } from '../enhancer/pricing';
import type { EnhancerSegment } from '../enhancer/enhancer';
import { tagsByMeeting, tagsForMeeting } from './organization';

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
  folder_id: number | null;
  updated_at: number | null;
  deepgram_audio_ms: number;
  deepgram_channels: number;
  claude_input_tokens: number;
  claude_output_tokens: number;
};

type SegmentRow = {
  channel: number;
  speaker_label: string;
  text: string;
  start_ms: number;
  end_ms: number;
  // V075 ROADMAP_02 + ROADMAP_03 — nullable JSON columns. Block 02 writes
  // paragraph break offsets; block 03 writes per-word filler spans.
  paragraph_breaks_json?: string | null;
  word_spans_json?: string | null;
};

// Tags default to [] here; list/detail callers attach them (one batched query for
// lists via tagsByMeeting, a single lookup for one meeting via tagsForMeeting).
function toSummary(row: MeetingRow): MeetingSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as MeetingStatus,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    templateId: row.template_id,
    folderId: row.folder_id,
    updatedAt: row.updated_at,
    tags: [],
  };
}

function rowToUsage(row: MeetingRow): MeetingUsage {
  return {
    deepgramAudioMs: row.deepgram_audio_ms ?? 0,
    deepgramChannels: row.deepgram_channels ?? 2,
    claudeInputTokens: row.claude_input_tokens ?? 0,
    claudeOutputTokens: row.claude_output_tokens ?? 0,
  };
}

const SUMMARY_COLUMNS =
  'id, title, status, created_at, started_at, ended_at, template_id, folder_id, updated_at, deepgram_audio_ms, deepgram_channels, claude_input_tokens, claude_output_tokens';

function getSummary(id: number): MeetingSummary {
  const row = getDb()
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM meetings WHERE id = ?`)
    .get(id) as MeetingRow | undefined;
  if (!row) throw new Error(`Meeting ${id} not found`);
  return { ...toSummary(row), tags: tagsForMeeting(id) };
}

export function createMeeting(folderId: number | null = null): MeetingSummary {
  const db = getDb();
  const createdAt = Date.now();
  const info = db
    .prepare(
      `INSERT INTO meetings (title, status, created_at, updated_at, folder_id) VALUES (?, 'draft', ?, ?, ?)`,
    )
    .run('Untitled meeting', createdAt, createdAt, folderId);
  const id = Number(info.lastInsertRowid);
  db.prepare(`INSERT INTO notes (meeting_id, raw_user_md) VALUES (?, '')`).run(id);
  rebuildMeetingFts(id);
  return {
    id,
    title: 'Untitled meeting',
    status: 'draft',
    createdAt,
    startedAt: null,
    endedAt: null,
    templateId: null,
    folderId,
    updatedAt: createdAt,
    tags: [],
  };
}

export function listMeetings(): MeetingSummary[] {
  const rows = getDb()
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM meetings ORDER BY created_at DESC`)
    .all() as MeetingRow[];
  const tags = tagsByMeeting();
  return rows.map((r) => ({ ...toSummary(r), tags: tags.get(r.id) ?? [] }));
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
    tags: tagsForMeeting(id),
    rawUserMd: note?.raw_user_md ?? '',
    enhancedJson: note?.enhanced_json ?? null,
    templateId: row.template_id,
    enhancedLang: note?.enhanced_lang ?? null,
    usage: rowToUsage(row),
  };
}

/**
 * Persist usage stats after transcription stops (Deepgram side) or after
 * enhancement (Claude side). Called with partial updates — columns not in the
 * update are left untouched via column-specific UPDATEs.
 */
export function saveDeepgramUsage(id: number, deepgramAudioMs: number, channels: number): void {
  getDb()
    .prepare(
      `UPDATE meetings
       SET deepgram_audio_ms = deepgram_audio_ms + ?,
           deepgram_channels = ?
       WHERE id = ?`,
    )
    .run(Math.round(deepgramAudioMs), channels, id);
}

export function saveClaudeUsage(
  id: number,
  inputTokens: number,
  outputTokens: number,
): void {
  getDb()
    .prepare(
      `UPDATE meetings
       SET claude_input_tokens  = claude_input_tokens  + ?,
           claude_output_tokens = claude_output_tokens + ?
       WHERE id = ?`,
    )
    .run(inputTokens, outputTokens, id);
}

/**
 * Aggregate usage totals across all meetings for the Settings "Usage & Cost" section.
 */
export function getUsageTotals(): UsageTotals {
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(deepgram_audio_ms),                      0) AS deepgramAudioMs,
         COALESCE(SUM(deepgram_audio_ms * deepgram_channels),  0) AS deepgramChannelMs,
         COALESCE(SUM(claude_input_tokens),                    0) AS claudeInputTokens,
         COALESCE(SUM(claude_output_tokens),                   0) AS claudeOutputTokens
       FROM meetings`,
    )
    .get() as {
    deepgramAudioMs: number;
    deepgramChannelMs: number;
    claudeInputTokens: number;
    claudeOutputTokens: number;
  };
  // Deepgram bills per channel, and meetings can have different channel counts
  // (legacy 2-channel vs V05 mono), so cost is summed over billed channel-minutes
  // rather than a single multiplier on the wall-clock total.
  const deepgramCostUsd =
    (row.deepgramChannelMs / 1000 / 60) * PRICING.deepgramNovaPerMinutePerChannel;
  const claudeCostUsd = estimateCost(0, row.claudeInputTokens, row.claudeOutputTokens);
  return {
    deepgramAudioMs: row.deepgramAudioMs,
    claudeInputTokens: row.claudeInputTokens,
    claudeOutputTokens: row.claudeOutputTokens,
    deepgramCostUsd,
    estimatedCostUsd: deepgramCostUsd + claudeCostUsd,
  };
}

/** Link a meeting to a template (or clear the link by passing null). */
export function setMeetingTemplate(meetingId: number, templateId: number | null): void {
  getDb()
    .prepare(`UPDATE meetings SET template_id = ? WHERE id = ?`)
    .run(templateId, meetingId);
}

export function saveNotes(id: number, markdown: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO notes (meeting_id, raw_user_md) VALUES (?, ?)
     ON CONFLICT(meeting_id) DO UPDATE SET raw_user_md = excluded.raw_user_md`,
  ).run(id, markdown);
  db.prepare(`UPDATE meetings SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
  rebuildMeetingFts(id);
}

export function updateTitle(id: number, title: string): void {
  getDb()
    .prepare(`UPDATE meetings SET title = ?, updated_at = ? WHERE id = ?`)
    .run(title, Date.now(), id);
  rebuildMeetingFts(id);
}

export function startMeeting(id: number): MeetingSummary {
  getDb()
    .prepare(`UPDATE meetings SET status = 'transcribing', started_at = ?, updated_at = ? WHERE id = ?`)
    .run(Date.now(), Date.now(), id);
  return getSummary(id);
}

export function endMeeting(id: number): MeetingSummary {
  getDb()
    .prepare(`UPDATE meetings SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?`)
    .run(Date.now(), Date.now(), id);
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
  // V075 ROADMAP_02 + ROADMAP_03: persist the optional paragraph break offsets
  // and (block 03) word spans as nullable JSON columns. NULL when empty/absent
  // so the vast majority of rows stay slim.
  const paragraphBreaksJson =
    seg.paragraphBreaks && seg.paragraphBreaks.length > 0
      ? JSON.stringify(seg.paragraphBreaks)
      : null;
  const wordSpansJson =
    seg.wordSpans && seg.wordSpans.length > 0 ? JSON.stringify(seg.wordSpans) : null;
  getDb()
    .prepare(
      `INSERT INTO transcript_segments
         (meeting_id, channel, speaker_label, text, start_ms, end_ms,
          paragraph_breaks_json, word_spans_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      meetingId,
      seg.channel,
      seg.speakerLabel,
      seg.text,
      Math.round(seg.startMs),
      Math.round(seg.endMs),
      paragraphBreaksJson,
      wordSpansJson,
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
  const db = getDb();
  db.prepare(
    `UPDATE notes SET enhanced_json = ?, enhanced_at = ?, enhanced_lang = ? WHERE meeting_id = ?`,
  ).run(enhancedJson, Date.now(), enhancedLang, id);
  db.prepare(`UPDATE meetings SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
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
      `SELECT id, channel, speaker_label, text, start_ms, end_ms,
              paragraph_breaks_json, word_spans_json
       FROM transcript_segments WHERE meeting_id = ? ORDER BY start_ms, id`,
    )
    .all(meetingId) as Array<SegmentRow & { id: number }>;
  return rows.map((r) => {
    const base: PersistedSegment = {
      id: r.id,
      text: r.text,
      channel: r.channel === 0 ? 0 : 1,
      speakerLabel: r.speaker_label,
      startMs: r.start_ms,
      endMs: r.end_ms,
      isFinal: true,
    };
    // V075 ROADMAP_02 — paragraph breaks live in their own optional column.
    if (r.paragraph_breaks_json) {
      try {
        const parsed = JSON.parse(r.paragraph_breaks_json);
        if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
          base.paragraphBreaks = parsed;
        }
      } catch {
        // Corrupt JSON shouldn't break a transcript read — fall through.
      }
    }
    // V075 ROADMAP_03 — wordSpans (currently filler spans) for muted renderer styling.
    if (r.word_spans_json) {
      try {
        const parsed = JSON.parse(r.word_spans_json);
        if (
          Array.isArray(parsed) &&
          parsed.every(
            (s) =>
              s &&
              typeof s.start === 'number' &&
              typeof s.end === 'number' &&
              typeof s.isFiller === 'boolean',
          )
        ) {
          base.wordSpans = parsed;
        }
      } catch {
        // Corrupt JSON shouldn't break a transcript read.
      }
    }
    return base;
  });
}

export function searchMeetings(query: string): MeetingSummary[] {
  const match = toFtsMatch(query);
  if (!match) return [];
  const cols = SUMMARY_COLUMNS.split(', ')
    .map((c) => `m.${c}`)
    .join(', ');
  const rows = getDb()
    .prepare(
      `SELECT ${cols}
       FROM search_fts f JOIN meetings m ON m.id = f.rowid
       WHERE search_fts MATCH ? ORDER BY rank`,
    )
    .all(match) as MeetingRow[];
  const tags = tagsByMeeting();
  return rows.map((r) => ({ ...toSummary(r), tags: tags.get(r.id) ?? [] }));
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
