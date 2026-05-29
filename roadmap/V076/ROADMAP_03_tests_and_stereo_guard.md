# ROADMAP_03 — Tests + stereo regression guard

## Context

V076 ROADMAP_01 + 02 are pure-function changes inside
`me-attribution.ts`. They need their own dedicated test file pinning
the new numeric behaviour so future re-tunes don't silently regress:

- The lenient zero-bleed regime (the main fix) — a window that V073
  classified not-Me is now Me.
- The strict full-bleed regime — the same window is still not-Me when
  bleed pegs the score to 1.
- Hysteresis sticks across a brief mic-energy dip.
- Hysteresis times out after the window expires.
- Hysteresis does not bridge a true remote run (mic-floor still
  gates).

Plus one regression guard for the stereo "Best quality" path: V075
ROADMAP_04 re-enabled the legacy multichannel branch in
`parse.ts:116-127` that maps `channel_index=[0]` → "Me"
unconditionally, by-construction. That path bypasses all V076 logic
and must keep working. A short test pins it so a future refactor that
touches `parseDeepgramMessage` can't silently break stereo.

## What changed

### `scribe/tests/me-attribution-mic-priority.test.ts` (new)

Five test cases. Use the existing `tests/me-attribution-bleed.test.ts`
as the template for synthesising an `EnergySample[]` timeline; the
shape is `{ tMs, mic, sys }[]` ordered ascending. Helper functions
`makeTimeline()` etc. already exist in that file — copy them or
import them.

```ts
import { describe, it, expect } from 'vitest';
import { attributeWords, groupAttributedWords } from '../src/main/transcription/me-attribution';
import type { EnergySample } from '../src/main/transcription/me-attribution';
import type { DeepgramWordView } from '../src/main/transcription/parse';

const word = (
  text: string,
  startMs: number,
  endMs: number,
  speaker = 0,
): DeepgramWordView => ({
  text,
  startMs,
  endMs,
  deepgramSpeaker: speaker,
  paragraphIndex: -1,
  isFiller: false,
});

const constTimeline = (
  mic: number,
  sys: number,
  durMs: number,
  frameMs = 100,
): EnergySample[] => {
  const out: EnergySample[] = [];
  for (let t = 0; t <= durMs; t += frameMs) out.push({ tMs: t, mic, sys });
  return out;
};

describe('V076 ROADMAP_01 — bleed-interpolated dominance', () => {
  it('zero bleed: mic just above sys classifies as Me', () => {
    // mic=0.05, sys=0.04 → ratio 1.25× — fails V073's 1.5× baseline
    // but passes V076's 1.0× zero-bleed bar (plus mic floor 0.01).
    const timeline = constTimeline(0.05, 0.04, 2000);
    const words = [word('hello', 500, 800), word('there', 850, 1100)];
    const out = attributeWords(words, timeline);
    expect(out.every((w) => w.isMe)).toBe(true);
  });

  it('full bleed: same window does NOT classify as Me', () => {
    // Constant correlated envelope → bleed score = 1 → effective
    // dominance = 3.0×. mic=0.05 needs sys ≤ 0.0167 to pass; sys=0.04
    // is well over that, so the words flip to not-Me. Use a mic+sys
    // pair that co-varies enough to push bleed to 1.
    // (Cleanest: rely on captureMode='speakers' to floor bleed at 0.5;
    // numeric trace: effDom = 1 + (3-1)*0.5 = 2.0 — still rejects.)
    const timeline = constTimeline(0.05, 0.04, 2000);
    const words = [word('hello', 500, 800), word('there', 850, 1100)];
    const out = attributeWords(words, timeline, { captureMode: 'speakers' });
    expect(out.every((w) => w.isMe === false)).toBe(true);
  });
});

describe('V076 ROADMAP_02 — Me-run hysteresis', () => {
  it('hysteresis flips a borderline word inside the 1.5s window', () => {
    // First word strongly Me (mic 0.12, sys 0.02 — well over even
    // the 3.0× full-bleed bar). Second word at mic=0.025, sys=0.04 —
    // ratio 0.625, below baseline 1.0× but above relaxed 0.7×.
    const timeline = [
      // First word window: 400–800 ms, mic loud
      ...Array.from({ length: 5 }, (_, i) => ({ tMs: 400 + i * 100, mic: 0.12, sys: 0.02 })),
      // Second word window: 1000–1300 ms, mic dips
      ...Array.from({ length: 4 }, (_, i) => ({ tMs: 1000 + i * 100, mic: 0.025, sys: 0.04 })),
    ];
    const words = [word('hello', 500, 750), word('there', 1050, 1250)];
    const out = attributeWords(words, timeline);
    expect(out[0].isMe).toBe(true);
    // 0.025 / 0.04 = 0.625, below 1.0× baseline, above 0.7× relaxed.
    // Hysteresis kicks in (second word is 300 ms after first → inside
    // the 1500 ms window) and flips it back to Me.
    expect(out[1].isMe).toBe(true);
  });

  it('hysteresis times out after 1.5s', () => {
    // Same as above but second word is 2 s after first → outside the
    // window, stays not-Me.
    const timeline = [
      ...Array.from({ length: 5 }, (_, i) => ({ tMs: 400 + i * 100, mic: 0.12, sys: 0.02 })),
      ...Array.from({ length: 4 }, (_, i) => ({ tMs: 3000 + i * 100, mic: 0.025, sys: 0.04 })),
    ];
    const words = [word('hello', 500, 750), word('there', 3050, 3250)];
    const out = attributeWords(words, timeline);
    expect(out[0].isMe).toBe(true);
    expect(out[1].isMe).toBe(false);
  });

  it('hysteresis does NOT bridge a true remote run (mic floor gates)', () => {
    // Me word, then a 3-word remote run with mic ≈ 0 (well below
    // floor). All three remote words stay not-Me regardless of
    // hysteresis — the floor check short-circuits.
    const timeline = [
      ...Array.from({ length: 5 }, (_, i) => ({ tMs: 400 + i * 100, mic: 0.12, sys: 0.02 })),
      ...Array.from({ length: 12 }, (_, i) => ({ tMs: 1000 + i * 100, mic: 0.001, sys: 0.08 })),
    ];
    const words = [
      word('hello', 500, 750),
      word('and', 1050, 1200),
      word('then', 1250, 1400),
      word('they', 1450, 1600),
    ];
    const out = attributeWords(words, timeline);
    expect(out[0].isMe).toBe(true);
    expect(out[1].isMe).toBe(false);
    expect(out[2].isMe).toBe(false);
    expect(out[3].isMe).toBe(false);
  });
});

describe('V076 — coalesced Me segment across former fragments', () => {
  it('grouping produces ONE Me segment for a hysteresis-rescued sequence', () => {
    // Validates the *user-visible* outcome: the per-word fixes
    // bubble through groupAttributedWords into one Me segment, not
    // three fragments.
    const timeline = [
      ...Array.from({ length: 5 }, (_, i) => ({ tMs: 400 + i * 100, mic: 0.12, sys: 0.02 })),
      ...Array.from({ length: 4 }, (_, i) => ({ tMs: 1000 + i * 100, mic: 0.025, sys: 0.04 })),
      ...Array.from({ length: 5 }, (_, i) => ({ tMs: 1500 + i * 100, mic: 0.12, sys: 0.02 })),
    ];
    const words = [
      word('hello', 500, 750),
      word('there', 1050, 1250),
      word('friend', 1550, 1900),
    ];
    const attributed = attributeWords(words, timeline);
    const segments = groupAttributedWords(attributed);
    expect(segments).toHaveLength(1);
    expect(segments[0].speakerLabel).toBe('Me');
    expect(segments[0].text).toBe('hello there friend');
  });
});
```

### Stereo regression guard

Either extend `scribe/tests/parse.test.ts` (verify first whether it
exists with `Glob`) or add a small new file
`scribe/tests/parse-stereo-me.test.ts`. Two cases:

```ts
import { describe, it, expect } from 'vitest';
import { parseDeepgramMessage } from '../src/main/transcription/parse';

describe('V075 stereo / V076 regression guard — channel 0 is always Me', () => {
  it('channel_index=[0] in multichannel mode always emits "Me"', () => {
    const msg = {
      type: 'Results',
      is_final: true,
      channel_index: [0, 1],
      start: 1.0,
      duration: 1.5,
      channel: {
        alternatives: [{
          transcript: 'hello there friend',
          words: [
            { word: 'hello', start: 1.0, end: 1.3, speaker: 0 },
            { word: 'there', start: 1.35, end: 1.6, speaker: 1 },
            { word: 'friend', start: 1.65, end: 2.5, speaker: 2 },
          ],
        }],
      },
    };
    const out = parseDeepgramMessage(msg, { singleChannel: false });
    expect(out).toHaveLength(1);
    expect(out[0].speakerLabel).toBe('Me');
    expect(out[0].channel).toBe(0);
    expect(out[0].text).toBe('hello there friend');
  });

  it('channel_index=[1] in multichannel mode splits by Deepgram speaker', () => {
    const msg = {
      type: 'Results',
      is_final: true,
      channel_index: [1, 1],
      start: 1.0,
      duration: 1.5,
      channel: {
        alternatives: [{
          transcript: 'hello there friend',
          words: [
            { word: 'hello', start: 1.0, end: 1.3, speaker: 0 },
            { word: 'there', start: 1.35, end: 1.6, speaker: 0 },
            { word: 'friend', start: 1.65, end: 2.5, speaker: 1 },
          ],
        }],
      },
    };
    const out = parseDeepgramMessage(msg, { singleChannel: false });
    expect(out).toHaveLength(2);
    expect(out[0].speakerLabel).toBe('Speaker 1');
    expect(out[1].speakerLabel).toBe('Speaker 2');
  });
});
```

These pin the V075 ROADMAP_04 stereo path so a future re-org of
`parseDeepgramMessage` (e.g. dropping the multichannel branch when
"finally moving everyone to V076 mono") would loudly fail CI rather
than silently break the "Best quality" capture mode.

### Existing tests to update

- `scribe/tests/me-attribution-bleed.test.ts` — re-derive the numeric
  expectations in the "Bleed-aware dominance" cases (lines 63–84) per
  the table in V076 ROADMAP_01. The *shape* of the assertions
  (dominance rises with bleed) holds.

### Existing tests that should stay green unchanged

- `tests/me-attribution.test.ts` (segment-level path; 5 tests).
- `tests/me-attribution-words.test.ts` (grouping + filler + paragraph
  paths; 12 tests) — none gate on the dominance threshold value
  itself.
- `tests/deepgram-query.test.ts` — no wire change.
- All V075 tests (paragraphs, filler words, stereo) — no upstream
  contract change.

## Files changed

- `scribe/tests/me-attribution-mic-priority.test.ts` (new) — ~5 cases
  for ROADMAP_01 + 02.
- `scribe/tests/parse-stereo-me.test.ts` (new — verify whether
  `parse.test.ts` exists first; extend if it does) — 2 cases pinning
  the stereo channel-0 path.
- `scribe/tests/me-attribution-bleed.test.ts` (modify) — re-derive
  numeric expectations under the V076 formula.

## Verification

- `corepack pnpm test` — expected suite size 281 → ~288 (281 +
  5 new mic-priority + 2 new stereo guard, with the existing
  bleed-test count unchanged because numbers shifted but counts
  didn't).
- `corepack pnpm typecheck` + `corepack pnpm lint` — clean.
- No manual verification needed for this block — block 01 + 02 own
  the live-call verification, and the stereo guard is a pure-data
  test.

§1 invariants: tests only.
