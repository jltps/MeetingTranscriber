import { describe, it, expect } from 'vitest';
import {
  attributeWords,
  groupAttributedWords,
  type AttributedWord,
  type EnergySample,
} from '../src/main/transcription/me-attribution';
import type { DeepgramWordView } from '../src/main/transcription/parse';

// Build a flat energy timeline at 10 Hz (100 ms frames) covering [startMs, endMs).
function timeline(startMs: number, endMs: number, mic: number, sys: number): EnergySample[] {
  const out: EnergySample[] = [];
  for (let tMs = startMs; tMs < endMs; tMs += 100) out.push({ tMs, mic, sys });
  return out;
}

function word(
  text: string,
  startMs: number,
  endMs: number,
  deepgramSpeaker: number,
  // -1 = no paragraph data (matches the V075 ROADMAP_01 parser sentinel when
  // the Deepgram response has no `paragraphs` block). Tests that don't care
  // about paragraphs use this default so grouping falls back to V073 behaviour.
  paragraphIndex: number = -1,
  isFiller: boolean = false,
): DeepgramWordView {
  return { text, startMs, endMs, deepgramSpeaker, paragraphIndex, isFiller };
}

describe('attributeWords', () => {
  it('flips isMe per word as the energy timeline flips', () => {
    // 0–1 s: mic dominant; 1–2 s: sys dominant.
    const tl: EnergySample[] = [
      ...timeline(0, 1000, 0.5, 0.05),
      ...timeline(1000, 2000, 0.05, 0.5),
    ];
    const words = [
      word('hi', 100, 300, 3),
      word('there', 400, 700, 3),
      word('hello', 1100, 1400, 4),
      word('world', 1500, 1800, 4),
    ];
    const out = attributeWords(words, tl);
    expect(out.map((w) => w.isMe)).toEqual([true, true, false, false]);
  });

  it('falls back to non-Me when the (padded) window has no samples', () => {
    const tl = timeline(0, 500, 0.5, 0.05); // ends well before the word
    const out = attributeWords([word('lonely', 5000, 5300, 3)], tl);
    expect(out[0].isMe).toBe(false);
  });
});

describe('groupAttributedWords', () => {
  // V075 ROADMAP_01: -1 = no paragraph data sentinel. Tests that don't pass an
  // explicit paragraph index get -1 so grouping falls back to V073 behaviour.
  const attr = (
    text: string,
    startMs: number,
    endMs: number,
    deepgramSpeaker: number,
    isMe: boolean,
    paragraphIndex: number = -1,
    isFiller: boolean = false,
  ): AttributedWord => ({ text, startMs, endMs, deepgramSpeaker, isMe, paragraphIndex, isFiller });

  it('returns [] for empty input', () => {
    expect(groupAttributedWords([])).toEqual([]);
  });

  it('collapses fragmentation: all-Me words across many Deepgram speakers → one "Me" segment', () => {
    const ws = [
      attr('I', 100, 200, 3, true),
      attr('think', 200, 400, 3, true),
      attr('we', 400, 500, 3, true),
      attr('should', 500, 700, 4, true),
      attr('ship', 700, 900, 4, true),
      attr('it', 900, 1000, 5, true),
    ];
    const segs = groupAttributedWords(ws);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      channel: 0,
      speakerLabel: 'Me',
      text: 'I think we should ship it',
      startMs: 100,
      endMs: 1000,
      isFinal: true,
    });
  });

  it('still splits non-Me runs on Deepgram-speaker change', () => {
    const ws = [
      attr('a', 100, 200, 3, false),
      attr('b', 200, 400, 3, false),
      attr('c', 400, 500, 2, false),
      attr('d', 500, 700, 2, false),
    ];
    const segs = groupAttributedWords(ws);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ channel: 1, speakerLabel: 'Speaker 4', text: 'a b' });
    expect(segs[1]).toMatchObject({ channel: 1, speakerLabel: 'Speaker 3', text: 'c d' });
  });

  it('mixed in and across runs: attribution splits within a speaker, fuses across speakers', () => {
    // [3(mic),3(mic),3(sys),2(sys),2(mic)] → Me / Speaker 4 / Speaker 3 / Me
    const ws = [
      attr('w1', 100, 200, 3, true),
      attr('w2', 200, 300, 3, true),
      attr('w3', 300, 400, 3, false),
      attr('w4', 400, 500, 2, false),
      attr('w5', 500, 600, 2, true),
    ];
    const segs = groupAttributedWords(ws);
    expect(segs).toHaveLength(4);
    expect(segs[0]).toMatchObject({ speakerLabel: 'Me', text: 'w1 w2' });
    expect(segs[1]).toMatchObject({ speakerLabel: 'Speaker 4', text: 'w3' });
    expect(segs[2]).toMatchObject({ speakerLabel: 'Speaker 3', text: 'w4' });
    expect(segs[3]).toMatchObject({ speakerLabel: 'Me', text: 'w5' });
  });
});

describe('attributeWords + groupAttributedWords integration', () => {
  it('reproduces the V062 fix: own-voice scattered across speaker IDs coalesces into one "Me"', () => {
    // Mic dominant throughout — every word should be Me.
    const tl = timeline(0, 2000, 0.4, 0.03);
    const words = [
      word('I', 100, 200, 3),
      word('would', 200, 400, 3),
      word('like', 400, 600, 4),
      word('to', 600, 700, 4),
      word('add', 700, 900, 5),
      word('one', 900, 1100, 5),
      word('thing', 1100, 1300, 5),
    ];
    const segs = groupAttributedWords(attributeWords(words, tl));
    expect(segs).toHaveLength(1);
    expect(segs[0].speakerLabel).toBe('Me');
    expect(segs[0].text).toBe('I would like to add one thing');
  });
});

// ─── V075 ROADMAP_02 — paragraph-aware grouping & merging ──────────────────────

describe('groupAttributedWords + V075 paragraph hints', () => {
  const attr = (
    text: string,
    startMs: number,
    endMs: number,
    deepgramSpeaker: number,
    isMe: boolean,
    paragraphIndex: number = 0,
    isFiller: boolean = false,
  ): AttributedWord => ({ text, startMs, endMs, deepgramSpeaker, isMe, paragraphIndex, isFiller });

  it('same-paragraph remote fragments auto-merge even when V073 word-rate heuristic would reject', () => {
    // Two ch1 segments from different Deepgram speakers, same paragraph index.
    // Deliberately mismatched word rates: the V073 heuristic would reject this
    // merge (frag1 ~6 wps, frag2 ~2 wps — >25% mismatch). With paragraphs as a
    // strong signal, it should merge anyway.
    const ws = [
      // frag1: 6 words in 1000ms → 6 wps
      attr('one', 0, 100, 3, false, 0),
      attr('two', 200, 300, 3, false, 0),
      attr('three', 400, 500, 3, false, 0),
      attr('four', 600, 700, 3, false, 0),
      attr('five', 800, 900, 3, false, 0),
      attr('six', 900, 1000, 3, false, 0),
      // 200 ms gap — within AUTO_MERGE_MAX_GAP_MS
      // frag2: 3 words spread over 1500 ms → 2 wps (very different rate)
      attr('seven', 1200, 1300, 4, false, 0),
      attr('eight', 2000, 2100, 4, false, 0),
      attr('nine', 2600, 2700, 4, false, 0),
    ];
    const segs = groupAttributedWords(ws);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      channel: 1,
      speakerLabel: 'Speaker 4',
      text: 'one two three four five six seven eight nine',
    });
  });

  it('different-paragraph remote fragments fall through to V073 heuristic (and stay split when it rejects)', () => {
    // Different paragraphs → no same-paragraph fast-path; mismatched word
    // rates → V073 heuristic rejects → segments stay split.
    const ws = [
      attr('one', 0, 100, 3, false, 0),
      attr('two', 200, 300, 3, false, 0),
      attr('three', 400, 500, 3, false, 0),
      attr('four', 600, 700, 3, false, 0),
      attr('five', 800, 900, 3, false, 0),
      attr('six', 900, 1000, 3, false, 0),
      // Different paragraph and bad word rate.
      attr('seven', 1200, 1300, 4, false, 1),
      attr('eight', 2000, 2100, 4, false, 1),
      attr('nine', 2600, 2700, 4, false, 1),
    ];
    const segs = groupAttributedWords(ws);
    expect(segs).toHaveLength(2);
    expect(segs[0].speakerLabel).toBe('Speaker 4');
    expect(segs[1].speakerLabel).toBe('Speaker 5');
  });

  it('single-speaker run across paragraphs emits one segment with paragraphBreaks at the boundary', () => {
    // All Me, all Deepgram speaker 0, two paragraphs.
    // "first second" → paragraph 0; "third fourth" → paragraph 1.
    const ws = [
      attr('first', 0, 100, 0, true, 0),
      attr('second', 200, 300, 0, true, 0),
      attr('third', 400, 500, 0, true, 1),
      attr('fourth', 600, 700, 0, true, 1),
    ];
    const segs = groupAttributedWords(ws);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('first second third fourth');
    // Break offset should land at the start of "third" in the joined text.
    // joined = "first second third fourth"
    //          0     6      13    19
    // Offset of the new paragraph's first word = 13.
    expect(segs[0].paragraphBreaks).toEqual([13]);
  });

  it('paragraphs absent (paragraphIndex=-1 sentinel) → grouping is identical to V073', () => {
    // Two adjacent 1-word remote fragments with no paragraph data (-1 sentinel).
    // V073 heuristic rejects (each fragment has <3 words), so they stay split —
    // V075's same-paragraph fast-path must NOT fire on the -1 sentinel.
    const ws = [
      attr('hi', 0, 100, 3, false, -1),
      attr('there', 200, 300, 4, false, -1),
    ];
    const segs = groupAttributedWords(ws);
    expect(segs).toHaveLength(2);
    expect(segs[0].speakerLabel).toBe('Speaker 4');
    expect(segs[1].speakerLabel).toBe('Speaker 5');
  });

  it('paragraphBreaks is omitted (not empty array) when no internal breaks exist', () => {
    const ws = [attr('hello', 0, 100, 0, true, 0)];
    const segs = groupAttributedWords(ws);
    expect(segs[0].paragraphBreaks).toBeUndefined();
  });

  // ─── V075 ROADMAP_03 — filler handling in grouping ───────────────────────

  it('records wordSpans for filler tokens at the correct character offsets', () => {
    // "I uh think" — "uh" is a filler at offset 2..4 in the joined text.
    const ws = [
      attr('I', 0, 100, 0, true, -1, false),
      attr('uh', 100, 200, 0, true, -1, true),
      attr('think', 200, 400, 0, true, -1, false),
    ];
    const segs = groupAttributedWords(ws);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('I uh think');
    expect(segs[0].wordSpans).toEqual([{ start: 2, end: 4, isFiller: true }]);
  });

  it('wordSpans is omitted when no fillers exist', () => {
    const ws = [attr('hello there', 0, 200, 0, true)];
    const segs = groupAttributedWords([
      attr('hello', 0, 100, 0, true),
      attr('there', 100, 200, 0, true),
    ]);
    expect(segs[0].wordSpans).toBeUndefined();
    expect(ws).toHaveLength(1); // unused; quiet the linter
  });
});

describe('attributeWords + V075 filler-inherit pass', () => {
  it('short isolated filler (<200 ms) inherits the previous non-filler word’s isMe', () => {
    // Wide-apart words with explicit single samples to keep the 60 ms windowPad
    // from bleeding into adjacent regions. "I" + "think" land in mic-dominant
    // samples; "uh" lands in a sys-dominant sample (would classify not-Me on
    // its own — the inherit pass must flip it back to true).
    const tl: EnergySample[] = [
      { tMs: 500, mic: 0.5, sys: 0.05 },   // "I" window [440, 660]
      { tMs: 1500, mic: 0.02, sys: 0.5 },  // "uh" window [1440, 1660] — sys dominant
      { tMs: 2500, mic: 0.5, sys: 0.05 },  // "think" window [2440, 2660]
    ];
    const words: DeepgramWordView[] = [
      { text: 'I', startMs: 500, endMs: 600, deepgramSpeaker: 0, paragraphIndex: -1, isFiller: false },
      { text: 'uh', startMs: 1500, endMs: 1600, deepgramSpeaker: 0, paragraphIndex: -1, isFiller: true },
      { text: 'think', startMs: 2500, endMs: 2600, deepgramSpeaker: 0, paragraphIndex: -1, isFiller: false },
    ];
    const out = attributeWords(words, tl);
    expect(out.map((w) => w.isMe)).toEqual([true, true, true]);
  });

  it('long filler (>200 ms) runs through the dominance check normally (no inherit)', () => {
    // 400 ms "uh" exceeds the FILLER_INHERIT_MAX_MS ceiling — keeps its
    // dominance result (false here).
    const tl: EnergySample[] = [
      { tMs: 500, mic: 0.5, sys: 0.05 },   // "yes" window [440, 660] — Me
      { tMs: 1700, mic: 0.02, sys: 0.5 },  // "uh" window [1440, 1960] — not Me
    ];
    const words: DeepgramWordView[] = [
      { text: 'yes', startMs: 500, endMs: 600, deepgramSpeaker: 0, paragraphIndex: -1, isFiller: false },
      // 400 ms duration — over the inherit ceiling.
      { text: 'uh', startMs: 1500, endMs: 1900, deepgramSpeaker: 0, paragraphIndex: -1, isFiller: true },
    ];
    const out = attributeWords(words, tl);
    expect(out.map((w) => w.isMe)).toEqual([true, false]);
  });
});
