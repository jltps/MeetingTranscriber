# ROADMAP_01 — Per-Word "Me" Attribution

> **Status: SHIPPED in v0.6.2.** Implemented exactly per the plan below: the
> per-word path is plumbed via an optional `onWords` callback on
> `TranscriptionSession`; single-channel finals route through it, interim and
> legacy 2-channel paths are unchanged. Unit tests cover fragmentation collapse,
> non-Me speaker splits, mixed runs, empty-window fallback, and end-to-end
> integration. §1 invariants held.

## Problem

In single-channel (mono) transcription, Deepgram diarization labels everyone
`"Speaker N"` and the local user is recovered after the fact by correlating each
segment's time window against the per-frame mic-vs-system RMS levels the capture
worklet sends. That recovery is implemented per *segment* today
(`scribe/src/main/transcription/me-attribution.ts:33–71`,
`scribe/src/main/ipc/transcription.ts:44–47`).

In live calls this misbehaves in one specific way: **the user's own speech is
scattered across several Deepgram speaker IDs** (Speaker 3, Speaker 4, Speaker 5,
…) instead of consistently appearing as `"Me"`. Two compounding causes:

1. **Deepgram does not preserve a stable speaker identity across a session.** Its
   diarizer readily fragments one physical voice into multiple speaker IDs after
   pauses, language shifts, or audio-quality variations. Each fragment becomes its
   own `TranscriptSegment`.
2. **Per-segment averaging buries the dominance signal in long, mixed segments.**
   A 12-second segment that starts with a remote speaker and shifts to the user
   mid-sentence averages mic + sys across the whole window. Even though most of
   the user's actual words *were* mic-dominant, the `mic >= sys * 1.5` test fails
   on the average and the segment stays `"Speaker N"`.

The result is what the user reports: their own voice appearing as Speaker 3,
Speaker 4, Speaker 5 in the same meeting.

## Goal

Eliminate own-voice scattering across `"Speaker N"` labels in single-channel
transcription by deciding `"Me"` per **word** and regrouping words by
**attribution first**, then Deepgram speaker.

## Non-goals (explicitly out of scope)

- Changing default `micFloor`/`dominance` thresholds (kept at `0.01` / `1.5`).
- Adding peak-RMS vs mean-RMS, cross-segment hysteresis, or any temporal smoothing.
- Exposing thresholds or tuning knobs in Settings.
- Diagnostic per-segment energy logging into the DB.
- The optional 2-channel high-accuracy mode (~2× Deepgram cost) Settings toggle.
- Voice fingerprinting or embeddings.
- Any change to the legacy 2-channel path (it stays as-is).
- Any change to interim-results behavior (live display stays on Deepgram's
  speaker label; attribution applies on `is_final` only).
- Any change to the UI, IPC contract, DB schema, enhancement, or language paths.

If per-word attribution alone proves insufficient — particularly for open-speaker
setups with system-audio bleed into the mic — those items above become candidate
follow-up blocks. Capture observations from manual verification (below) into a
future-work note in `roadmap/V062/`.

## Pipeline diff

**Today (V05 ROADMAP_02):**

```
Deepgram Results (is_final, words[])
  └─► parseDeepgramMessage / splitBySpeaker
        groups consecutive same-speaker words → TranscriptSegment[]
  └─► attributeSpeaker(seg) per segment
        averages mic+sys over [start-150ms, end+150ms]
        sets channel:0, speakerLabel:"Me" if dominance test passes
        otherwise leaves "Speaker N+1" unchanged
  └─► persist + send to renderer
```

**After (V062):**

```
Deepgram Results (is_final, words[])
  └─► parseDeepgramWords
        emits DeepgramWordView[] = {text, startMs, endMs, deepgramSpeaker}
        (no pre-grouping)
  └─► attributeWords(words, energyTimeline)
        per-word energy query over [wStart-60ms, wEnd+60ms]
        emits AttributedWord[] = {...word, isMe: boolean}
  └─► groupAttributedWords(attributedWords)
        splits on attribution change OR (deepgramSpeaker change AND !isMe)
        all consecutive Me-words coalesce into one "Me" segment
        non-Me words still split by Deepgram speaker as today
  └─► persist + send to renderer
```

The key invariant of the new grouping: **`isMe` is the primary partition key.**
Two consecutive words both attributed `isMe=true` fuse into the same segment even
when Deepgram tagged them with different speaker IDs (the fragmentation case).
Two consecutive `isMe=false` words split on Deepgram-speaker change, preserving
remote-speaker separation exactly as today.

## Where the code changes land

References use `file:line` from the current tree; treat as orientation, not as
literal post-edit line numbers.

### `scribe/src/main/transcription/parse.ts`

- Add a pure function:

  ```
  parseDeepgramWords(message, opts?): { words: DeepgramWordView[]; isFinal: boolean }
  ```

  where `DeepgramWordView = { text: string; startMs: number; endMs: number;
  deepgramSpeaker: number }`. Computes `text` from `punctuated_word ?? word`,
  millisecond timestamps from Deepgram's seconds, and `deepgramSpeaker` from
  `word.speaker ?? 0`. Returns `{words: [], isFinal}` for non-`Results` messages,
  for results with no alternatives or empty transcript, and for interim results
  (the per-word path is final-only). Does not look at `channel_index` — that
  remains the legacy parser's concern.

- Keep `parseDeepgramMessage` exported and unchanged for the **legacy 2-channel
  branch and the interim path**. The single-channel-final caller in
  `ipc/transcription.ts` switches to `parseDeepgramWords`. Decide during
  implementation whether `splitBySpeaker` survives as a defensive fallback (used
  only when `words` is missing/empty on a final result) or is inlined — either is
  fine as long as the legacy branch `!singleChannel && channel === 0` keeps
  emitting exactly one `{channel:0, speakerLabel:"Me"}` segment per result.

### `scribe/src/main/transcription/me-attribution.ts`

- Add:

  ```
  attributeWords(
    words: readonly DeepgramWordView[],
    timeline: readonly EnergySample[],
    options?: MeAttributionOptions,
  ): AttributedWord[]
  ```

  where `AttributedWord = DeepgramWordView & { isMe: boolean }`. For each word,
  call the existing `micDominatedWindow(timeline, w.startMs, w.endMs, options)`
  and set `isMe` from the result. The shared `micFloor` / `dominance` defaults
  carry over. Default `windowPadMs` for this path is `60` (vs the segment-level
  `150`) — rationale in a short code comment: word time windows are typically
  200–800 ms, so a tighter pad keeps the dominance signal sharp without losing
  the small bit of slack needed for word-boundary jitter.

- Add:

  ```
  groupAttributedWords(words: readonly AttributedWord[]): TranscriptSegment[]
  ```

  Iterates `words`, opening a run on the first word and on every boundary. A
  boundary is:
  - `prev.isMe !== curr.isMe`, OR
  - `prev.isMe === false && curr.isMe === false && prev.deepgramSpeaker !== curr.deepgramSpeaker`.

  When `isMe` runs end, emit `{channel: 0, speakerLabel: "Me", ...}`; when
  non-Me runs end, emit `{channel: 1, speakerLabel: "Speaker ${dgSpeaker+1}",
  ...}`. `startMs` is the first word's start; `endMs` is the last word's end;
  `text` is the words joined with single spaces; `isFinal: true`. Empty input
  returns `[]`.

- Keep `attributeMe` and `micDominatedWindow` exported and unchanged — the legacy
  2-channel path doesn't use them, but the existing unit tests do, and
  `attributeMe` is also harmless to keep available.

### `scribe/src/main/ipc/transcription.ts`

- The `transcriptionPushFrame` handler is unchanged — it still appends to
  `energyTimeline` exactly as today (line 106). No new IPC channel, no new
  validation, no new payload shape.

- The `createTranscriptionSession({ onSegment })` callback (line 64) is the only
  call site that changes behavior, and only for single-channel finals. Today it
  calls `attributeSpeaker(seg)` (which calls `attributeMe`) on every segment. The
  new flow: when `audioChannels === 1`, the transcription session needs to
  surface word-level data on finals so this layer can run `parseDeepgramWords` →
  `attributeWords` → `groupAttributedWords` and forward the resulting segments
  (each persisted with `insertTranscriptSegment` and sent on
  `IPC.transcriptionSegment`).

  Two implementation shapes are acceptable; pick the one that disturbs the
  fewest files (decide by reading
  `scribe/src/main/transcription/deepgram.ts` and the `TranscriptionSession`
  interface in `scribe/src/main/transcription/session.ts`):

  1. **Pass word-level data through the existing `onSegment` callback** by
     adding an optional `onWords` callback to the `TranscriptionSession`
     constructor that fires on finals in single-channel mode. The IPC layer
     subscribes to `onWords`, runs the new pipeline, and emits regrouped
     segments; the existing `onSegment` continues to fire for interim results
     and legacy multichannel only.
  2. **Move the per-word path into `deepgram.ts`'s message handler**, so the
     session emits already-regrouped `TranscriptSegment[]` on finals when in
     single-channel mode. The IPC layer's `attributeSpeaker` becomes a no-op
     for single-channel finals (or is removed and gated upstream).

  Shape (1) keeps the energy timeline lookup co-located with the timeline owner
  (the IPC handler), which is the simpler reading. Default to (1) unless reading
  the session interface makes (2) obviously cleaner.

- Legacy 2-channel and interim paths continue to flow through the existing
  `attributeSpeaker(seg)` → no behavior change.

### `scribe/src/shared/types.ts`

- No changes expected. The on-wire `TranscriptSegment` shape stays the same; only
  how segments are produced changes. Confirm during implementation by greping
  `TranscriptSegment` callers — if a field truly needs to be added (e.g. an
  attribution-source marker for diagnostics), that's a separate decision and
  out of scope for this block.

### Other files

- `scribe/src/main/db/meetings.ts` `insertTranscriptSegment` — unchanged; the
  segments handed in have the same shape as today.
- `scribe/src/main/db/speakers.ts` (speaker naming + `reassignSegment`) —
  unchanged. Manual reassign continues to work; users still see `"Speaker N"`
  for remote speakers and can rename them as today.
- `scribe/src/main/transcription/deepgram.ts` query parameters — unchanged. Same
  `diarize=true`, `smart_format=true`, `channels=1`, `nova-3`. The fix is
  downstream of the wire format.
- Renderer — unchanged. It receives `TranscriptSegment` on `IPC.transcriptionSegment`
  exactly as today.

## Test plan

### Unit tests

Add to `scribe/src/main/transcription/__tests__/` (verify the exact path during
implementation; if a different test directory is used in this repo, match it).
All tests are pure — no socket, no DB, no Electron.

1. **Per-word `isMe` flips with synthetic energy.** Construct an `EnergySample[]`
   timeline where the first 1 s has `mic=0.5, sys=0.05` (clearly mic-dominant)
   and the next 1 s has `mic=0.05, sys=0.5` (clearly sys-dominant). Feed a word
   list with words alternating across those windows. Assert `isMe` flips
   accordingly.

2. **Fragmentation collapse.** Word list with `deepgramSpeaker` sequence
   `[3,3,3,4,4,5]` and a timeline that makes every word mic-dominant. Assert the
   regrouper emits exactly one `{speakerLabel: "Me"}` segment containing all six
   words.

3. **Non-Me speakers still split.** Word list with `deepgramSpeaker` `[3,3,2,2]`
   and a timeline that makes every word sys-dominant. Assert two segments —
   `"Speaker 4"` then `"Speaker 3"` (note Deepgram's 0-indexed `speaker` +1 in
   the label, matching `splitBySpeaker`'s current convention).

4. **Mixed in and across runs.** Word list `[3(mic),3(mic),3(sys),2(sys),2(mic)]`.
   Expect four segments: `Me` / `Speaker 4` / `Speaker 3` / `Me`. Proves
   attribution can split inside a single Deepgram speaker run and re-fuse Me
   across speaker boundaries.

5. **Empty energy window falls back to non-Me.** A word whose `[start-60ms,
   end+60ms]` window contains no samples in the timeline. Assert `isMe === false`
   (matches `micDominatedWindow`'s existing `n === 0 → false` semantics).

6. **Empty word list.** `groupAttributedWords([])` returns `[]`.

7. **Existing tests still pass.** Whatever tests currently cover `attributeMe`,
   `micDominatedWindow`, and `parseDeepgramMessage`/`splitBySpeaker` continue to
   pass unchanged — the legacy exports are not modified.

### Manual verification (varies-setup; per memory `env_pnpm_corepack`)

Run from `scribe/`:

```
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm dev
```

Two live runs:

- **Headphones run.** A multi-person call where the user speaks at least 8
  distinct times across at least 10 minutes. Verify after the meeting that the
  user appears only as `"Me"` in the transcript — no `"Speaker N"` fragments
  attributable to the user's voice. Spot-check by reading segments with the
  meeting still fresh in memory.
- **Open-speaker run.** Same exercise with system audio on speakers (some bleed
  expected). Acceptance is weaker here: most of the user's utterances should
  appear as `"Me"`; any remaining misattribution should be on short interjections
  under loud remote audio, not on long sustained speech. Capture concrete
  examples of any remaining failures in the commit message — they motivate the
  deferred follow-up work (heuristic tuning, peak-RMS, or the 2-channel mode).

## Risk & rollback

- All behavior changes are gated by the single-channel branch
  (`audioChannels === 1`) in `scribe/src/main/ipc/transcription.ts`. Legacy
  2-channel transcription is mathematically untouched.
- Interim results continue to flow through the existing path, so the live UI
  stream looks the same up to the moment a final arrives.
- If the per-word path regresses something not caught by tests, revert the
  IPC-layer edit (and the small additions to `parse.ts` /
  `me-attribution.ts`, which are pure additions and safe to leave). The
  segment-level `attributeMe(seg)` call returns to being the single source of
  truth.

## §1 invariants — affirmation checklist for the commit

- **§1.1 No audio to disk / in memory longer than transport.** The energy
  timeline still holds only scalar mic/sys RMS values keyed by `tMs`, exactly as
  V05. No new audio buffer is introduced.
- **§1.2 API keys never in the renderer / never logged.** No change. The new
  code lives entirely in main; no key handling involved.
- **§1.3 Renderer is untrusted.** No new IPC channels. `transcriptionPushFrame`
  and `transcriptionSegment` payloads are unchanged; no new Zod schemas needed.
- **§1.4 No bot, no meeting-platform integration.** Unaffected.
- **§1.5 User notes are sacred.** Unaffected.
- **§1.6 JSON contract.** Unaffected — enhancement layer is not touched.
- **§1.7 Never default to English.** Unaffected — Deepgram language handling and
  the enhancer language resolution are not touched.

State each invariant explicitly in the commit message per CLAUDE.md §10.

## Acceptance

- Unit tests above pass; existing transcription tests unchanged.
- `corepack pnpm typecheck` / `lint` / `test` / `build` all clean.
- Headphones live run: no own-voice `"Speaker N"` fragments observed.
- Open-speaker live run: behavior characterized in the commit message
  (improvement over V05 baseline expected but full correctness not required).
- One commit, directly to `main` (per memory `commit-to-main`), Conventional
  Commits format.
