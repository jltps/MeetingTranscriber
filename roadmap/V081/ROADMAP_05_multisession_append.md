# ROADMAP_05 — Multi-session transcript append

Today a 2nd recording **appends rows but resets timestamps to ~0**, so
`ORDER BY start_ms` interleaves the two sessions. Fix = offset the new session
past the existing transcript, mark it a new session, tell the user (no dialog).

## DB
- **Migration v15** (`db/migrations.ts`, latest is v14): additive
  `ALTER TABLE transcript_segments ADD COLUMN session_seq INTEGER NOT NULL DEFAULT 1;`
- `db/meetings.ts`: add `getMaxSegmentEndMs(meetingId)` (0 when none) and
  `getMaxSessionSeq(meetingId)` (0 when none). `insertTranscriptSegment` gains a
  `sessionSeq` param + writes `session_seq`. `getTranscript` selects `session_seq`
  into `PersistedSegment`. Add optional `sessionSeq?: number` to `TranscriptSegment`
  (`shared/types.ts`) + `TranscriptSegmentSchema`. `getEnhancerSegments` unchanged
  (already reads the union → enhancement treats sessions as one).

## IPC (`ipc/transcription.ts` `transcriptionStart`)
- Snapshot `sessionBaseMs = getMaxSegmentEndMs(meetingId)` and
  `sessionSeq = getMaxSessionSeq(meetingId) + 1`.
- In both `onSegment` and `onWords`, **after attribution** (attribution uses the
  session-relative energy timeline, so do not offset before it) add `sessionBaseMs`
  to `startMs/endMs` and set `sessionSeq` before `insertTranscriptSegment` + `send`.
- **Gladia insights alignment**: in `finalizeInsights`, add `sessionBaseMs` to each
  provider-insight utterance's `startMs/endMs` before `reconcileInsights`, so they
  overlap the (now-offset) persisted transcript. Capture `sessionBaseMs` per
  session alongside the existing `enrichMeetingId`.

## Renderer
- `App.tsx` `start()`: if `loadedSegments.length > 0`, snapshot them as
  `appendBase` and show a **friendly non-blocking banner** (auto-dismiss): e.g.
  *"Continuing this note — your new recording is being added to the existing
  transcript (Session N)."* Reuse the `AudioWarningBanner` style / a small notice.
- While recording an append session, show prior + live:
  `finals = showingActive ? [...appendBase, ...transcription.finals] : loadedSegments`.
- `TranscriptPanel.tsx`: render a subtle **"Session N"** divider before the first
  segment whose `session_seq` increments (compute boundaries from `session_seq`;
  the live appended block is the newest session).
- `db/export.ts`: include `session_seq` in the backup segment shape (optional,
  default 1) + restore it, so dividers survive backup/restore.

## Verify
Record once, stop, record again into the same note → friendly banner; the prior
transcript is visible while the new session records; a "Session 2" divider
separates them; combined enhancement covers both; with Gladia, insights still line
up with the offset transcript.
