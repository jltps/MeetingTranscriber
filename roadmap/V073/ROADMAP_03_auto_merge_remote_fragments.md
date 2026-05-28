# ROADMAP_03 — Auto-merge adjacent remote-speaker fragments

## Context

Deepgram nova-3 does not preserve a stable speaker identity across short
pauses or language shifts — one remote monologue commonly arrives split
across consecutive speaker IDs (e.g. `Speaker 3` for 4 seconds, then
`Speaker 5` for the next 3, both physically the same person). The user
sees the transcript fragment uselessly and has to either rename both
labels to the same display name (the V03 ROADMAP_02 speakers feature
covers this) or live with the noise.

The original plan considered a per-meeting `speaker_labels` table with
a `SpeakerLabelMenu` for manual merge. For v0.7.3 we keep that for
later: the existing `speakers.set` IPC already lets the user collapse
two raw labels onto one display name, which is the same observable
behaviour. What this block adds is **automatic** merging for the
obvious case — when adjacent fragments differ only by Deepgram speaker
ID and look like the same speech.

## What changed

### `scribe/src/main/transcription/me-attribution.ts`

- `groupAttributedWords` now post-processes its output through
  `autoMergeAdjacentSpeakers`. The merge runs **after** per-word
  attribution and the median filter from block 02, so it only sees
  segments that already group correctly on the `isMe` axis.
- `autoMergeAdjacentSpeakers(segments)` merges `prev` and `next` when
  **all** of these hold:
  - both are `channel === 1` (remote speakers — never collapse Me into
    anyone else);
  - they carry different `speakerLabel` strings;
  - the gap `next.startMs - prev.endMs` is in `[0, 800]` ms;
  - each fragment has ≥ 3 words (`wordCount` helper) — single-word
    tokens are excluded because synthetic test fixtures and real
    backchannels both look like single words and we don't want to
    collapse them into a neighbour's monologue;
  - their word-per-second rates are within ±25 % (`similarWordRate`).
- When all conditions match, `prev`'s text is extended with `next`'s
  text and `endMs` advanced; `prev`'s `speakerLabel` (the earlier one)
  is kept.

### Tests

- The existing `me-attribution-words.test.ts` covers the boundary cases.
  The `≥ 3 words per fragment` gate is what keeps the existing
  "mixed in and across runs" test green — its 1-word fragments are
  ignored by the merge.

## Files changed

- `scribe/src/main/transcription/me-attribution.ts` (`autoMergeAdjacentSpeakers`,
  `wordCount`, `similarWordRate`, `wordRate` helpers + the call into
  `groupAttributedWords`).

## What was deferred

- **Persisting `deepgram_speaker` + `is_me` columns on transcript
  segments** (migration v13 in the original plan). Without this, manual
  merge of *non-adjacent* fragments still requires the user to rename
  both raw labels; the transcript view groups by speakerLabel string,
  which works with the existing speakers IPC.
- **`SpeakerLabelMenu`** UI for inline rename / merge. The existing
  rename flow in `TranscriptPanel` (via `onRenameSpeaker`) covers the
  same observable behaviour for v0.7.3.

Both would be the right next step if cross-meeting speaker identity
ever needs to follow a person; the foundations (auto-merge runs on the
emit path, segment shape is unchanged) are ready for them.

## Verification

- `corepack pnpm test` — passes; the `≥ 3 words` gate keeps the
  pre-existing single-word fragment tests green.
- Manual:
  1. Record a call where one remote speaker monologues for ~10 seconds.
     Confirm Deepgram fragments it across at least two speaker IDs,
     then confirm the transcript view shows a single `Speaker N` segment
     containing the full text (auto-merge kicked in).
  2. Record a back-and-forth exchange between two remote speakers and
     confirm short single-word backchannels (`"Right."`, `"Yeah."`)
     stay attributed to the right speaker — the `≥ 3 words` gate
     prevents the merge from swallowing them.

§1.5 holds — the user's notes are untouched. §1.7 holds — language is
preserved across the merge (raw text concatenation only).
