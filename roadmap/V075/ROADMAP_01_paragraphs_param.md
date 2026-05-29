# ROADMAP_01 — `paragraphs=true` + parse layer

## Context

Deepgram's [`paragraphs`](https://developers.deepgram.com/docs/paragraphs)
parameter returns an extra block inside each `alternatives` object:

```json
"paragraphs": {
  "transcript": "…",
  "paragraphs": [
    { "sentences": [...], "num_words": N, "start": 12.34, "end": 23.45 },
    ...
  ]
}
```

Per Deepgram's docs, "paragraph breaks are influenced by speaker changes"
when diarization is on, and "by channel changes" with multichannel. In
both cases the paragraph boundaries Deepgram chooses are *already*
diarization-aware — i.e. Deepgram is internally computing a
second-order speaker/channel boundary signal that V073's auto-merge is
currently re-inventing from word-rate + 800 ms-gap heuristics.

This block adds the parameter and threads paragraph indices through the
parser so block 02 can consume them. It also pins the entire Deepgram
query string against silent drift via a new test — V05's `detect_language`
regression silently broke nova-3 streaming with HTTP 400 for weeks, and
the right place to catch that class of bug is a test on
`buildDeepgramQuery`.

## What changed

### `scribe/src/main/transcription/deepgram.ts`

- `buildDeepgramQuery` adds `paragraphs: 'true'` alongside the existing
  `diarize` / `smart_format` / `punctuate` / `interim_results` /
  `encoding` / `sample_rate` / `channels` / `language` params.
- A comment block above the function documents (a) why streaming stays
  on `diarize=true` (i.e. v1; `diarize_model` is pre-recorded only and
  returns HTTP 400 on streaming) and (b) why `punctuate=true` +
  `smart_format=true` are invariants (the enhancer prompt §1.6 assumes
  punctuated input; `smart_format` is what makes paragraphs meaningful
  in EN/ES).

### `scribe/src/main/transcription/parse.ts`

- New local type `DeepgramParagraph = { start: number; end: number }`
  (the minimal projection — sentence-level data is unused by V075).
- `DeepgramWordView` gains `paragraphIndex: number` (always present;
  `0` when the response omits paragraphs, so block 02 can treat
  "0 vs >0" uniformly without `undefined` checks).
- `parseDeepgramWords` pulls `alternative.paragraphs?.paragraphs`
  into an array of `{ start, end }`, then assigns each word's
  `paragraphIndex` by scanning the array for the first paragraph whose
  `[start, end)` range contains the word's `start` timestamp (with a
  safety fallback to the *previous* paragraph index on words that fall
  in a gap between paragraphs, which happens rarely at sentence
  boundaries). Linear scan — typical paragraph count per message is
  ≤ 3, so a binary search isn't worth the complexity.
- `parseDeepgramMessage` (the legacy multichannel + interim path) is
  unchanged. Paragraphs flow only through `parseDeepgramWords`, which
  is the single-channel finals path that V062 / V073 already operate
  on.

### `scribe/tests/deepgram-query.test.ts` (new)

- Pins the exact query-string set: `model=nova-3`, `diarize=true`,
  `smart_format=true`, `punctuate=true`, `interim_results=true`,
  `encoding=linear16`, `paragraphs=true`,
  `multichannel=true` only when `channels > 1`,
  `language` resolution per V05 rules (`auto` → `multi`,
  `fixed` → `bcp47`).
- One test per param so a regression names the broken param directly.

### `scribe/tests/parse-deepgram-paragraphs.test.ts` (new, or extension of
the existing `parse-deepgram` test file — verify naming before creating)

- `paragraphs` absent → all words get `paragraphIndex = 0`.
- `paragraphs` present (3 entries) → words bucket correctly at the
  boundaries.
- Word `start` falls in the gap between paragraphs N and N+1 → inherits
  paragraph N (fallback rule).
- Word `start` precedes the first paragraph's `start` (interim edge) →
  paragraph 0.

## Files changed

- `scribe/src/main/transcription/deepgram.ts`
- `scribe/src/main/transcription/parse.ts`
- `scribe/tests/deepgram-query.test.ts` (new)
- `scribe/tests/parse-deepgram-paragraphs.test.ts` (new or extension)

## Verification

- `corepack pnpm test` — all suites pass. Existing
  `me-attribution-words.test.ts` cases continue to pass because the new
  `paragraphIndex` field defaults to `0` on synthetic fixtures.
- `corepack pnpm typecheck` — clean. The `DeepgramWordView` change is
  the only type that crosses files; the per-word attribution layer
  doesn't read paragraphs yet (that's block 02).
- Manual:
  1. `corepack pnpm dev`, run a 60-second call, open DevTools on the
     main process logger.
  2. Confirm the Deepgram URL query in the WebSocket open includes
     `paragraphs=true`.
  3. Confirm at least one Deepgram message includes a `paragraphs`
     block in `channel.alternatives[0]`.
  4. No visible UI change yet — block 02 surfaces the signal.

§1 invariants: no audio bytes anywhere, no new persistence, keys stay
main-side, language auto-detect unaffected (paragraphs flows on every
language).
