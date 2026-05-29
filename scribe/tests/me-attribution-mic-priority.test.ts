import { describe, it, expect } from 'vitest';
import {
  attributeWords,
  groupAttributedWords,
  type EnergySample,
} from '../src/main/transcription/me-attribution';
import type { DeepgramWordView } from '../src/main/transcription/parse';

// V076 — bleed-aware mic-priority "Me" attribution.
//
// Two coupled changes verified here:
//   1. The dominance bar now interpolates from 1.0× at bleed=0 up to 4.0× at
//      bleed=1 (V073 was 1.5× → 4.5×). The zero-bleed common case is lenient
//      by design — quiet Me speech over a normal-volume remote now classifies
//      as Me.
//   2. Me-run hysteresis: once a word is classified Me, the next ≤ 1.5 s of
//      borderline words get a 0.7× multiplier on the effective dominance bar
//      so a brief mic-energy dip doesn't fracture a coherent Me utterance.
//      The mic floor is NOT relaxed: true remote runs (mic ≈ silence) still
//      flip off Me cleanly.

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
  it('zero bleed: mic just over sys (1.25×) classifies as Me', () => {
    // V073's 1.5× baseline rejected this. V076's 1.0× zero-bleed bar accepts.
    // mic 0.05 >= floor 0.01; mic 0.05 >= sys 0.04 × 1.0 = 0.04.
    const timeline = constTimeline(0.05, 0.04, 2000);
    const words = [word('hello', 500, 800), word('there', 850, 1100)];
    const out = attributeWords(words, timeline);
    expect(out.every((w) => w.isMe)).toBe(true);
  });

  it('full-bleed (speakers mode): same 1.25× ratio is rejected', () => {
    // captureMode='speakers' floors bleed at 0.5 → effDominance = 1.0 + 3.0 ×
    // 0.5 = 2.5. mic 0.05 needs sys ≤ 0.02 to pass; sys=0.04 fails.
    const timeline = constTimeline(0.05, 0.04, 2000);
    const words = [word('hello', 500, 800), word('there', 850, 1100)];
    const out = attributeWords(words, timeline, { captureMode: 'speakers' });
    expect(out.every((w) => w.isMe === false)).toBe(true);
  });
});

describe('V076 ROADMAP_02 — Me-run hysteresis', () => {
  it('flips a borderline word back to Me inside the 1.5 s window', () => {
    // First word strongly Me (mic 0.12, sys 0.02 — well over even a 4.0× bar).
    // Second word at mic 0.03, sys 0.04 — ratio 0.75. Below the 1.0× baseline
    // but above the 0.7× relaxed bar.
    const timeline: EnergySample[] = [
      ...[400, 500, 600, 700, 800].map((tMs) => ({ tMs, mic: 0.12, sys: 0.02 })),
      ...[1000, 1100, 1200, 1300].map((tMs) => ({ tMs, mic: 0.03, sys: 0.04 })),
    ];
    const words = [word('hello', 500, 750), word('there', 1050, 1250)];
    const out = attributeWords(words, timeline);
    expect(out[0].isMe).toBe(true);
    // Second word is 300 ms after the first → inside the 1500 ms hysteresis
    // window. The 0.7× multiplier drops the effective bar to 0.7×; 0.75 ≥ 0.7
    // → flipped back to Me.
    expect(out[1].isMe).toBe(true);
  });

  it('times out after 1.5 s', () => {
    // Same shape but the second word arrives 2 s later → outside the window.
    const timeline: EnergySample[] = [
      ...[400, 500, 600, 700, 800].map((tMs) => ({ tMs, mic: 0.12, sys: 0.02 })),
      ...[3000, 3100, 3200, 3300].map((tMs) => ({ tMs, mic: 0.03, sys: 0.04 })),
    ];
    const words = [word('hello', 500, 750), word('there', 3050, 3250)];
    const out = attributeWords(words, timeline);
    expect(out[0].isMe).toBe(true);
    expect(out[1].isMe).toBe(false);
  });

  it('does NOT bridge a true remote run (mic floor still gates)', () => {
    // Me word, then a 3-word remote run with mic ≈ silence. The mic floor
    // (0.01) rejects regardless of hysteresis: 0.001 < 0.01 short-circuits
    // the dominance check.
    const timeline: EnergySample[] = [
      ...[400, 500, 600, 700, 800].map((tMs) => ({ tMs, mic: 0.12, sys: 0.02 })),
      ...[1000, 1100, 1200, 1300, 1400, 1500, 1600].map((tMs) => ({
        tMs,
        mic: 0.001,
        sys: 0.08,
      })),
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

describe('V076 — end-to-end coalescence', () => {
  it('groups a hysteresis-rescued sequence into ONE Me segment (no fragments)', () => {
    // Validates the user-visible outcome: the per-word fixes bubble through
    // groupAttributedWords into one Me segment, not three (Me / Speaker N / Me).
    const timeline: EnergySample[] = [
      ...[400, 500, 600, 700, 800].map((tMs) => ({ tMs, mic: 0.12, sys: 0.02 })),
      ...[1000, 1100, 1200, 1300].map((tMs) => ({ tMs, mic: 0.03, sys: 0.04 })),
      ...[1500, 1600, 1700, 1800, 1900].map((tMs) => ({
        tMs,
        mic: 0.12,
        sys: 0.02,
      })),
    ];
    const words = [
      word('hello', 500, 750),
      // Borderline middle word — same Deepgram speaker, just a quieter
      // syllable. V073 would have flipped this to "Speaker 1"; V076 keeps
      // it Me via hysteresis.
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
