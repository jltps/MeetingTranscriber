// Post-call audio-intelligence storage (V08, Gladia). The `meeting_insights`
// table (migration v14) holds one normalized MeetingInsights blob per meeting
// plus the job status and the Gladia session id(s) needed to resume a fetch
// after an app restart. Insights are a *separate* layer from notes (§1.5) and
// the transcript — they never write `notes`/`enhanced_json`.
import type { MeetingInsights, MeetingInsightsSummary } from '../../shared/types';
import { getDb } from './index';

type InsightsRow = {
  meeting_id: number;
  provider: string;
  status: string;
  insights_json: string | null;
  session_ids_json: string | null;
  error: string | null;
  updated_at: number;
};

const EMPTY_SUMMARY: MeetingInsightsSummary = {
  speakers: [],
  entityCounts: [],
  topEntities: [],
  sentiment: { positive: 0, neutral: 0, negative: 0 },
};

function parseSessionIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) return parsed;
  } catch {
    /* corrupt — treat as none */
  }
  return [];
}

/**
 * Returns the meeting's insights, or null when no row exists. When the job is
 * still `processing` (or errored) the `utterances`/`summary` are empty but
 * `status` reflects reality so the UI can show an "Analysing…"/error state.
 * Corrupt `insights_json` never throws a read.
 */
export function getInsights(meetingId: number): MeetingInsights | null {
  const row = getDb()
    .prepare(
      `SELECT meeting_id, provider, status, insights_json, session_ids_json, error, updated_at
       FROM meeting_insights WHERE meeting_id = ?`,
    )
    .get(meetingId) as InsightsRow | undefined;
  if (!row) return null;

  const status = row.status === 'ready' || row.status === 'error' ? row.status : 'processing';
  const base: MeetingInsights = {
    provider: 'gladia',
    status,
    utterances: [],
    summary: EMPTY_SUMMARY,
  };
  if (row.error) base.error = row.error;
  if (row.insights_json) {
    try {
      const parsed = JSON.parse(row.insights_json) as Partial<MeetingInsights>;
      if (Array.isArray(parsed.utterances)) base.utterances = parsed.utterances;
      if (parsed.summary) base.summary = parsed.summary;
    } catch {
      // Corrupt JSON shouldn't break a read — keep the empty defaults.
    }
  }
  return base;
}

/** Persist the finished, normalized insights (status → 'ready'). */
export function saveInsights(
  meetingId: number,
  insights: MeetingInsights,
  sessionIds: string[],
): void {
  const json = JSON.stringify({ utterances: insights.utterances, summary: insights.summary });
  getDb()
    .prepare(
      `INSERT INTO meeting_insights
         (meeting_id, provider, status, insights_json, session_ids_json, error, updated_at)
       VALUES (?, 'gladia', 'ready', ?, ?, NULL, ?)
       ON CONFLICT(meeting_id) DO UPDATE SET
         status = 'ready', insights_json = excluded.insights_json,
         session_ids_json = excluded.session_ids_json, error = NULL,
         updated_at = excluded.updated_at`,
    )
    .run(meetingId, json, JSON.stringify(sessionIds), Date.now());
}

/** Mark a meeting's insights as in-flight (status → 'processing'). */
export function setInsightsProcessing(
  meetingId: number,
  provider: string,
  sessionIds: string[],
): void {
  getDb()
    .prepare(
      `INSERT INTO meeting_insights
         (meeting_id, provider, status, insights_json, session_ids_json, error, updated_at)
       VALUES (?, ?, 'processing', NULL, ?, NULL, ?)
       ON CONFLICT(meeting_id) DO UPDATE SET
         provider = excluded.provider, status = 'processing', insights_json = NULL,
         session_ids_json = excluded.session_ids_json, error = NULL,
         updated_at = excluded.updated_at`,
    )
    .run(meetingId, provider, JSON.stringify(sessionIds), Date.now());
}

/** Record a failed enrichment (status → 'error'); keeps any prior insights_json. */
export function setInsightsError(meetingId: number, message: string): void {
  getDb()
    .prepare(
      `INSERT INTO meeting_insights
         (meeting_id, provider, status, insights_json, session_ids_json, error, updated_at)
       VALUES (?, 'gladia', 'error', NULL, NULL, ?, ?)
       ON CONFLICT(meeting_id) DO UPDATE SET
         status = 'error', error = excluded.error, updated_at = excluded.updated_at`,
    )
    .run(meetingId, message, Date.now());
}

/** Rows still `processing` — used at boot to resume an interrupted fetch (V08). */
export function getPendingInsights(): Array<{
  meetingId: number;
  provider: string;
  sessionIds: string[];
}> {
  const rows = getDb()
    .prepare(
      `SELECT meeting_id, provider, session_ids_json FROM meeting_insights WHERE status = 'processing'`,
    )
    .all() as Array<Pick<InsightsRow, 'meeting_id' | 'provider' | 'session_ids_json'>>;
  return rows.map((r) => ({
    meetingId: r.meeting_id,
    provider: r.provider,
    sessionIds: parseSessionIds(r.session_ids_json),
  }));
}
