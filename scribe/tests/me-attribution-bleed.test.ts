import { describe, it, expect } from 'vitest';
import {
  attributeWords,
  computeBleedScore,
  micDominatedWindow,
  type EnergySample,
} from '../src/main/transcription/me-attribution';
import type { DeepgramWordView } from '../src/main/transcription/parse';

// V073: bleed-aware "Me" attribution. When the user is on speakers their voice
// leaks into the mic; if we don't compensate, the per-word energy heuristic
// mis-tags remote speakers as "Me". computeBleedScore measures the leak via
// the normalised cross-correlation of mic and system RMS envelopes; the
// micDominatedWindow heuristic then raises the dominance threshold in
// proportion.

function word(
  text: string,
  startMs: number,
  endMs: number,
  deepgramSpeaker: number,
  paragraphIndex: number = -1,
  isFiller: boolean = false,
): DeepgramWordView {
  return { text, startMs, endMs, deepgramSpeaker, paragraphIndex, isFiller };
}

describe('computeBleedScore', () => {
  it('returns 0 for an empty timeline', () => {
    expect(computeBleedScore([], 1000)).toBe(0);
  });

  it('returns 0 when the mic and system envelopes are constant (no co-variation)', () => {
    // Flat constants → variance is zero → correlation undefined → clamped 0.
    const tl: EnergySample[] = [];
    for (let t = 0; t < 5000; t += 100) tl.push({ tMs: t, mic: 0.2, sys: 0.1 });
    expect(computeBleedScore(tl, 5000)).toBe(0);
  });

  it('returns close to 1 when mic and system move together (heavy bleed)', () => {
    // Synthesize a varying envelope and put a scaled copy on the mic — that's
    // the textbook signature of speakers leaking into the microphone.
    const tl: EnergySample[] = [];
    for (let i = 0; i < 50; i++) {
      const v = 0.05 + 0.4 * Math.abs(Math.sin(i / 3));
      tl.push({ tMs: i * 100, mic: v * 0.6, sys: v });
    }
    const score = computeBleedScore(tl, 5000);
    expect(score).toBeGreaterThan(0.9);
  });

  it('returns ~0 when mic and system envelopes are anti-correlated (turn-taking)', () => {
    // Classic call shape: when the remote talks, the mic is quiet, and vice versa.
    const tl: EnergySample[] = [];
    for (let i = 0; i < 50; i++) {
      const v = 0.05 + 0.4 * Math.abs(Math.sin(i / 3));
      tl.push({ tMs: i * 100, mic: 0.45 - v * 0.8, sys: v });
    }
    expect(computeBleedScore(tl, 5000)).toBeLessThan(0.1);
  });
});

describe('micDominatedWindow under bleed', () => {
  it('still counts a clear mic peak as Me when the rest of the timeline shows no bleed', () => {
    // 5 s of silence + one 200 ms mic peak.
    const tl: EnergySample[] = [];
    for (let t = 0; t < 5000; t += 100) tl.push({ tMs: t, mic: 0.001, sys: 0.001 });
    for (let t = 4900; t < 5100; t += 100) tl.push({ tMs: t, mic: 0.5, sys: 0.02 });
    tl.sort((a, b) => a.tMs - b.tMs);
    expect(micDominatedWindow(tl, 4900, 5100)).toBe(true);
  });

  it('rejects a borderline mic edge over a heavily bleeding window', () => {
    // Strong co-variation throughout — bleed score will be near 1, raising
    // the effective dominance bar to ~4.5. A ratio of 2× is no longer enough.
    const tl: EnergySample[] = [];
    for (let i = 0; i < 60; i++) {
      const v = 0.05 + 0.4 * Math.abs(Math.sin(i / 3));
      tl.push({ tMs: i * 100, mic: v * 0.6, sys: v });
    }
    // Word at the end of the bleeding window: mic only 2× system — should NOT
    // win under bleed adjustment.
    expect(micDominatedWindow(tl, 5500, 5800)).toBe(false);
  });
});

describe('captureMode override', () => {
  it("headphones mode ignores bleed and treats mic dominance the old way", () => {
    const tl: EnergySample[] = [];
    for (let i = 0; i < 60; i++) {
      const v = 0.05 + 0.4 * Math.abs(Math.sin(i / 3));
      tl.push({ tMs: i * 100, mic: v * 1.8, sys: v });
    }
    // Same fixture as the bleed test, but mic 1.8× system. Headphones mode
    // ignores bleed → dominance stays at 1.5 → 1.8× still counts as Me.
    expect(
      micDominatedWindow(tl, 5500, 5800, { captureMode: 'headphones' }),
    ).toBe(true);
    // Auto mode (default) sees the heavy bleed and rejects.
    expect(micDominatedWindow(tl, 5500, 5800)).toBe(false);
  });

  it('speakers mode floors bleed at 0.5 even on a clean timeline', () => {
    // No bleed in the data, but speakers mode assumes ≥0.5 — so a 2× mic edge
    // (which would normally pass under dominance 1.5) is rejected.
    const tl: EnergySample[] = [];
    for (let t = 0; t < 5000; t += 100) tl.push({ tMs: t, mic: 0.2, sys: 0.1 });
    expect(micDominatedWindow(tl, 2000, 2200)).toBe(true);
    expect(micDominatedWindow(tl, 2000, 2200, { captureMode: 'speakers' })).toBe(false);
  });
});

describe('attributeWords median filter', () => {
  it('flips a single mis-classified short Me word inside a remote monologue', () => {
    // Long remote stretch, mic-energy-wise.
    const tl: EnergySample[] = [];
    for (let t = 0; t < 4000; t += 100) tl.push({ tMs: t, mic: 0.02, sys: 0.3 });
    // V076: concentrate the burst on a single frame *inside* the "yes" word
    // window only, so adjacent words ("plan", "looks") don't see enough
    // mic energy to flip Me under the new 1.0× zero-bleed bar. This keeps the
    // median filter as the sole rescue mechanism (hysteresis can't chain
    // because there is no prior Me anchor).
    tl.push({ tMs: 1300, mic: 0.8, sys: 0.02 });
    tl.sort((a, b) => a.tMs - b.tMs);
    const words = [
      word('the', 1000, 1150, 4),
      word('plan', 1150, 1280, 4),
      word('yes', 1290, 1390, 4), // 100 ms — short enough to median-filter
      word('looks', 1400, 1600, 4),
      word('good', 1600, 1800, 4),
    ];
    const out = attributeWords(words, tl);
    // Without the filter, "yes" would land isMe=true mid-monologue. With it,
    // the single-word flip surrounded by non-Me peers is corrected back.
    expect(out[2].isMe).toBe(false);
    // Neighbours stay non-Me.
    expect(out[1].isMe).toBe(false);
    expect(out[3].isMe).toBe(false);
  });
});
