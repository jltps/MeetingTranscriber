import { getDb } from './index';
import type { SpeakerName } from '../../shared/types';

// Per-meeting speaker name mapping (ROADMAP_02). All DB access stays in the main
// process; the renderer reaches it via the IPC bridge. Pattern mirrors db/templates.ts.

type SpeakerRow = {
  raw_label: string;
  display_name: string;
};

function toSpeakerName(row: SpeakerRow): SpeakerName {
  return { rawLabel: row.raw_label, displayName: row.display_name };
}

/**
 * Return all user-assigned name mappings for a meeting.
 * Returns an empty array when no mappings exist (raw labels are used by default).
 */
export function getSpeakerNames(meetingId: number): SpeakerName[] {
  const rows = getDb()
    .prepare(`SELECT raw_label, display_name FROM speaker_names WHERE meeting_id = ?`)
    .all(meetingId) as SpeakerRow[];
  return rows.map(toSpeakerName);
}

/**
 * Create or replace a name mapping for a speaker label in a meeting.
 * If rawLabel === displayName the caller should use clearSpeakerName instead;
 * this function accepts any non-empty pair.
 */
export function setSpeakerName(meetingId: number, rawLabel: string, displayName: string): void {
  getDb()
    .prepare(
      `INSERT INTO speaker_names (meeting_id, raw_label, display_name)
       VALUES (?, ?, ?)
       ON CONFLICT(meeting_id, raw_label) DO UPDATE SET display_name = excluded.display_name`,
    )
    .run(meetingId, rawLabel, displayName);
}

/**
 * Delete a name mapping, reverting that label back to the original raw label.
 * No-op if no mapping exists.
 */
export function clearSpeakerName(meetingId: number, rawLabel: string): void {
  getDb()
    .prepare(`DELETE FROM speaker_names WHERE meeting_id = ? AND raw_label = ?`)
    .run(meetingId, rawLabel);
}

/**
 * Reassign a single persisted segment to a different speaker label.
 * This is the correction path for mislabeled segments — it updates the segment row
 * directly (the meeting's speaker_names mapping is unaffected).
 */
export function reassignSegment(
  meetingId: number,
  segmentId: number,
  newRawLabel: string,
): void {
  getDb()
    .prepare(
      `UPDATE transcript_segments
       SET speaker_label = ?
       WHERE id = ? AND meeting_id = ?`,
    )
    .run(newRawLabel, segmentId, meetingId);
}
