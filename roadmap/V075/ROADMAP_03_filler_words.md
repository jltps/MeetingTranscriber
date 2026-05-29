# ROADMAP_03 — Filler words capture & UX

## Context

Deepgram's default behaviour strips the two most common fillers (`uh`
and `um`) from the transcript "to improve readability". The
[`filler_words=true`](https://developers.deepgram.com/docs/filler-words)
parameter preserves them, plus five others: `mhmm, mm-mm, uh-uh,
uh-huh, nuh-uh` — i.e. the canonical seven. English only.

Two reasons to capture them:

1. **Transcript fidelity.** Users editing the enhanced notes sometimes
   want to see exactly what was said, including hesitations. Today the
   default-stripped fillers leave gaps that can flip the meaning of a
   sentence (`"I am, uh, leaning no"` vs `"I am leaning no"`).
2. **Diarization signal.** Backchannels like `mm-hmm` from a remote
   speaker during the user's monologue currently look like a 100 ms
   transcript blip with no speaker context — capturing them gives the
   bleed-aware Me heuristic explicit short tokens to either inherit a
   neighbour's `isMe` from or to ignore.

Trade-off: short filler tokens are the worst case for V062's per-word
Me-attribution dominance check (a 100 ms "uh" has too little energy
information to decide). V075 handles this by making short isolated
fillers *inherit* their neighbours' `isMe` instead of running the
heuristic on them.

User-confirmed default: **ON by default, subdued rendering**.

## What changed

### `scribe/src/main/transcription/deepgram.ts`

- `buildDeepgramQuery` adds `filler_words: 'true'` *gated on language*:
  set when `setting.mode === 'fixed' && setting.bcp47.startsWith('en')`
  OR `setting.mode === 'auto'` (auto = nova-3 `language=multi`;
  Deepgram accepts the param harmlessly in multi mode, falls back to
  default-strip when the detected language isn't English).
- Implementation lives entirely inside `buildDeepgramQuery` so the
  test in `deepgram-query.test.ts` (block 01) extends with three
  cases: en fixed → param set; pt-PT fixed → param NOT set; auto →
  param set.

### `scribe/src/main/transcription/parse.ts`

- New exported constant `FILLER_TOKENS` — `Set<string>` of the seven
  canonical lowercased tokens.
- `DeepgramWordView` gains `isFiller: boolean` (always present;
  `false` when not a filler).
- Detection runs on the *unpunctuated* `word` field, lowercased, with
  any trailing/leading punctuation stripped. Using `word` not
  `punctuated_word` keeps `"uh,"` matching `"uh"`.
- New parser branch: when `transcript_include_fillers` is `false`,
  fillers are dropped at the parser stage so they never reach the
  attribution layer or the DB. This matches Deepgram's
  default-stripped behaviour exactly.

### `scribe/src/main/transcription/me-attribution.ts`

- `AttributedWord` gains `isFiller: boolean` (forwarded from
  `DeepgramWordView`).
- `attributeWords`: a new pre-pass identifies **short isolated fillers**
  — `isFiller === true` AND `endMs - startMs < 200 ms` AND neither
  flanking non-filler word has been emitted yet (or is missing). For
  these, the dominance check is skipped and `isMe` is taken from the
  nearest neighbour (preferring the *previous* non-filler word; falling
  back to the next, falling back to `false`). The existing 1-word
  median filter still runs after this pass.
- `groupAttributedWords`: filler-only runs (a sequence of words where
  every word has `isFiller === true`) don't start a new
  `TranscriptSegment` of their own — they're absorbed into the
  preceding segment if attribution matches, otherwise into the
  following segment.
- `autoMergeAdjacentSpeakers`: a fragment whose only words are fillers
  never blocks the same-paragraph (V075 block 02) or
  word-rate-heuristic (V073) merge between its neighbours.

### `scribe/src/shared/types.ts`

- `TranscriptSegment` gains an optional
  `wordSpans?: { start: number; end: number; isFiller: boolean }[]`
  (character offsets into `text`; ascending). Present whenever fillers
  exist in the segment; the renderer uses it to wrap filler tokens in
  a subdued span. Optional + additive.

### `scribe/src/shared/ipc-contract.ts`

- `TranscriptSegmentSchema` adds the optional `wordSpans` field.
- New `SettingsView.transcriptIncludeFillers: boolean` (default `true`).
- New `SettingsApi.setTranscriptIncludeFillers(enabled)`.

### `scribe/src/main/db/migrations.ts`

- Migration **v13** (shared with block 02) covers the
  `word_spans_json TEXT NULL` column.

### `scribe/src/main/db/transcripts.ts`

- `insertTranscriptSegment` writes `wordSpans` to `word_spans_json`
  (JSON-encoded; NULL when empty/absent).
- Row mapper reads `word_spans_json` back.

### `scribe/src/main/db/settings.ts`

- `getTranscriptIncludeFillers()` / `setTranscriptIncludeFillers(b)`
  reading and writing the `transcript_include_fillers` key in the
  existing KV `settings` table. **No migration.** Defaults to `true`.

### `scribe/src/main/ipc/settings.ts`

- `settings:get` returns `transcriptIncludeFillers`.
- `settings:setTranscriptIncludeFillers` validates with a Zod boolean.

### `scribe/src/main/ipc/transcription.ts`

- Snapshots `getTranscriptIncludeFillers()` into session-local state
  on `transcription:start`. Passes the flag down through the parser
  branch (or through `attributeWords` as a config field — verify the
  cleaner site before wiring). Mid-meeting changes require Stop/Start,
  matching the V073 capture-mode pattern.

### `scribe/src/renderer/features/settings/SettingsModal.tsx`

- New row in the **Transcription** tab (V074 split): "Include filler
  words (uh, um, mm…)" with a `Switch` and a one-line help string
  noting it applies to English transcripts only (Deepgram's
  constraint).

### `scribe/src/renderer/features/transcript/TranscriptPanel.tsx`

- When a segment has a non-empty `wordSpans` array, the renderer
  splits the `text` into spans: filler spans get
  `text-muted-foreground italic` (verify the Tailwind v4 design-token
  equivalent before writing); non-filler spans render plain.
- The split is presentation-only — `segment.text` stays canonical.

### `scribe/tests/parse-deepgram-paragraphs.test.ts` (extend)

- All seven canonical fillers detect (case- and punctuation-
  insensitive). Tokens that contain a filler as a substring
  (e.g. `"umbrella"`, `"umm"`) do *not* match — require exact
  unpunctuated equality.
- `transcript_include_fillers = false` strips at parse time;
  `DeepgramWordView[]` returned contains zero filler entries.

### `scribe/tests/me-attribution-words.test.ts` (extend)

- Short isolated filler (`endMs - startMs = 100 ms`) inherits the
  previous word's `isMe`.
- A filler-only fragment between two same-attribution remote runs
  doesn't break the merge.
- Existing tests (no fillers in fixtures) continue to pass
  unchanged — `isFiller` defaults to `false` everywhere.

## Files changed

- `scribe/src/main/transcription/deepgram.ts`
- `scribe/src/main/transcription/parse.ts`
- `scribe/src/main/transcription/me-attribution.ts`
- `scribe/src/shared/types.ts`
- `scribe/src/shared/ipc-contract.ts`
- `scribe/src/main/db/migrations.ts` (v13, shared with block 02)
- `scribe/src/main/db/transcripts.ts`
- `scribe/src/main/db/settings.ts`
- `scribe/src/main/ipc/settings.ts`
- `scribe/src/main/ipc/transcription.ts`
- `scribe/src/preload/index.ts`
- `scribe/src/renderer/features/settings/SettingsModal.tsx`
- `scribe/src/renderer/features/transcript/TranscriptPanel.tsx`
- `scribe/tests/parse-deepgram-paragraphs.test.ts` (extend)
- `scribe/tests/me-attribution-words.test.ts` (extend)
- `scribe/tests/deepgram-query.test.ts` (extend — filler gate cases)

## Verification

- `corepack pnpm test` — all suites pass. New cases pin filler
  detection + neighbour-inheritance + grouping behaviour + the EN-only
  query gate.
- `corepack pnpm typecheck` / `lint` — clean.
- Manual:
  1. `corepack pnpm dev`, run a short call in English with the
     default ON. Confirm `uh`/`um` show up in the transcript in a
     muted italic style; toggle off in Settings and confirm a
     restarted call produces a transcript without them.
  2. Run a short call in Portuguese (pt-PT). Confirm `filler_words`
     is *not* in the WebSocket query string (DevTools main process).

§1 invariants: no new audio handling, no new keys, language
auto-detect preserved (the EN-only gate is the §1.7 guard). The
on-wire JSON enhancer contract is unchanged — `wordSpans` is a
renderer-only annotation never sent to the LLM.
