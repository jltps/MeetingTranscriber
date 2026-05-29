# ROADMAP_02 — Paragraph-aware grouping & merging

## Context

V062 ROADMAP_01 made `groupAttributedWords` partition on `isMe` first,
Deepgram speaker ID second. V073 ROADMAP_03 added
`autoMergeAdjacentSpeakers` as a post-pass that collapses adjacent
remote fragments (channel 1 only) when the gap is < 800 ms, both
fragments have ≥ 3 words, and word rates agree within ±25 %. That
heuristic catches the common case but misses fragments separated by a
longer pause, a code-switch, or any case where the word-rate check is
too noisy.

Block 01 plumbed `paragraphIndex` onto every word. Deepgram's paragraph
breaks are explicitly diarization-aware ("influenced by speaker
changes" per the docs). When two adjacent remote fragments share a
paragraph index, Deepgram itself is asserting they're one thought —
that's a stronger signal than our heuristic.

This block uses paragraph index as the merge override and lets long
single-speaker monologues that span multiple paragraphs render with an
internal break for readability.

## What changed

### `scribe/src/main/transcription/me-attribution.ts`

- `AttributedWord` gains `paragraphIndex: number` (passed through from
  `DeepgramWordView`). `attributeWords` is otherwise unchanged —
  paragraph data flows through to grouping only.
- `groupAttributedWords` records each emitted `TranscriptSegment`'s
  `paragraphIndex` range as `paragraphBreaks: number[]` (character
  offsets into the segment's `text` where the paragraph index
  *increases*). For most segments this is `[]`; long single-speaker
  monologues that span paragraphs get one or more entries.
- `autoMergeAdjacentSpeakers` (V073 block 03.3) gains a
  same-paragraph fast-path: if two adjacent remote fragments share a
  `paragraphIndex`, they merge **unconditionally** — skip the
  word-rate / 800 ms-gap / ≥3-words checks. Different-paragraph
  fragments still go through the existing conservative merge. New
  constant: `SAME_PARAGRAPH_MERGE = true` (sentinel; not user-tunable
  in V075).
- A consequence: when a single remote speaker monologues across two
  paragraphs without a Deepgram-speaker-ID flip, no merge happens
  (because grouping never split them in the first place). The
  paragraph break still gets recorded in `paragraphBreaks` for the
  renderer.

### `scribe/src/shared/types.ts`

- `TranscriptSegment` gains an optional `paragraphBreaks?: number[]`
  (character offsets into `text`; ascending; empty/absent means no
  internal breaks). Optional + additive — older meetings rendered
  without paragraphs continue to render correctly.

### `scribe/src/shared/ipc-contract.ts`

- `TranscriptSegmentSchema` adds the optional `paragraphBreaks` field.

### `scribe/src/main/db/migrations.ts`

- **Migration v13** (additive, shared with block 03):
  ```sql
  ALTER TABLE transcript_segments ADD COLUMN paragraph_breaks_json TEXT NULL;
  ALTER TABLE transcript_segments ADD COLUMN word_spans_json       TEXT NULL;
  ```
  Both NULLable. Existing rows stay readable; renderer treats NULL as
  "no breaks recorded".

### `scribe/src/main/db/transcripts.ts`

- `insertTranscriptSegment` writes `paragraphBreaks` to
  `paragraph_breaks_json` (JSON-encoded; NULL when empty/absent).
- Row mapper reads `paragraph_breaks_json` back into
  `segment.paragraphBreaks` on load.

### `scribe/src/renderer/features/transcript/TranscriptPanel.tsx`

- When a `TranscriptSegment` has a non-empty `paragraphBreaks`, the
  renderer inserts a `<br /><br />` (or the equivalent visual gap
  using the Tailwind v4 token — verify before writing) at each
  character offset. Cleaner reading on long monologues without
  fragmenting the speaker label.
- No change to the speaker-label column or the timestamp display.

### `scribe/tests/me-attribution-words.test.ts` (extend)

- **Same-paragraph remote merge**: two adjacent ch1 fragments with
  different Deepgram speaker IDs but identical `paragraphIndex`
  merge. The word-rate / gap heuristic is *not* consulted (assert by
  using a deliberately bad word-rate match that the V073 heuristic
  would reject).
- **Different-paragraph remote no-merge**: same setup but different
  `paragraphIndex` — falls through to the V073 heuristic and either
  merges or not based on word rates / gap.
- **Single-speaker run across paragraphs**: one isMe run spanning two
  paragraphs emits one segment with `paragraphBreaks: [N]` where N
  is the character offset of the boundary word.
- **Paragraphs absent (block 01 fallback)**: all words have
  `paragraphIndex = 0`; grouping behaves identically to V073 (no
  spurious merges).

## Files changed

- `scribe/src/main/transcription/me-attribution.ts`
- `scribe/src/shared/types.ts`
- `scribe/src/shared/ipc-contract.ts`
- `scribe/src/main/db/migrations.ts`
- `scribe/src/main/db/transcripts.ts`
- `scribe/src/renderer/features/transcript/TranscriptPanel.tsx`
- `scribe/tests/me-attribution-words.test.ts` (extend)
- `scribe/tests/migrations.test.ts` (extend — verify v13 is additive,
  populated DBs stay readable)

## Verification

- `corepack pnpm test` — all suites pass, including the new merge
  cases and the v13 migration test on a populated in-memory DB.
- `corepack pnpm typecheck` / `lint` — clean.
- Manual (the most important verification — the diarization-quality
  win is only visible live):
  1. `corepack pnpm dev`, run a 5-minute call with at least two
     remote speakers and one extended monologue (~30 s) from one
     remote speaker.
  2. Before V075: the monologue typically fragments into 2–4
     `Speaker 1` runs as Deepgram swaps its internal speaker ID at
     pauses. After V075: the monologue should collapse into one
     `Speaker 1` segment whenever Deepgram puts those fragments in
     the same paragraph. Eyeball the rendered transcript.
  3. Confirm a long single-speaker monologue shows an internal
     blank-line break at paragraph boundaries (renderer change).

§1 invariants: pure mapping change in `me-attribution.ts`, pure
parser/DB additive change otherwise; no audio bytes, no new keys, no
JSON-contract change for the enhancer.
