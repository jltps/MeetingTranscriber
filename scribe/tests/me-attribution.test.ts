import { describe, it, expect } from 'vitest';
import { attributeMe, micDominatedWindow, type EnergySample } from '../src/main/transcription/me-attribution';
import type { TranscriptSegment } from '../src/shared/types';

// Build a flat energy timeline at 10 Hz (100 ms frames) for [0, durationMs).
function timeline(durationMs: number, mic: number, sys: number): EnergySample[] {
  const out: EnergySample[] = [];
  for (let tMs = 0; tMs < durationMs; tMs += 100) out.push({ tMs, mic, sys });
  return out;
}

const seg = (overrides: Partial<TranscriptSegment> = {}): TranscriptSegment => ({
  text: 'hello',
  channel: 1,
  speakerLabel: 'Speaker 1',
  startMs: 1000,
  endMs: 2000,
  isFinal: true,
  ...overrides,
});

describe('micDominatedWindow', () => {
  it('returns true when the mic clearly dominates the system audio', () => {
    expect(micDominatedWindow(timeline(3000, 0.2, 0.02), 1000, 2000)).toBe(true);
  });

  it('returns false when system audio dominates (a remote speaker)', () => {
    expect(micDominatedWindow(timeline(3000, 0.02, 0.2), 1000, 2000)).toBe(false);
  });

  it('returns false below the mic RMS floor even with no system audio (silence/noise)', () => {
    expect(micDominatedWindow(timeline(3000, 0.005, 0.0), 1000, 2000)).toBe(false);
  });

  it('returns false when there is no energy data for the window', () => {
    expect(micDominatedWindow([], 1000, 2000)).toBe(false);
    // Samples exist but none fall inside the (padded) window.
    expect(micDominatedWindow(timeline(500, 0.3, 0.0), 5000, 6000)).toBe(false);
  });

  it('respects the dominance ratio (mic just above system is not enough)', () => {
    // mic 0.1 vs sys 0.09 → ratio < 1.5 → not dominant.
    expect(micDominatedWindow(timeline(3000, 0.1, 0.09), 1000, 2000)).toBe(false);
  });
});

describe('attributeMe', () => {
  it('relabels a mic-dominant segment to "Me" on channel 0', () => {
    const out = attributeMe(seg(), timeline(3000, 0.25, 0.01));
    expect(out).toMatchObject({ channel: 0, speakerLabel: 'Me' });
  });

  it('leaves a system-dominant segment untouched as "Speaker N"', () => {
    const input = seg();
    const out = attributeMe(input, timeline(3000, 0.01, 0.25));
    expect(out).toBe(input); // unchanged reference
    expect(out).toMatchObject({ channel: 1, speakerLabel: 'Speaker 1' });
  });

  it('passes through a segment already labelled "Me"', () => {
    const input = seg({ channel: 0, speakerLabel: 'Me' });
    expect(attributeMe(input, timeline(3000, 0.01, 0.25))).toBe(input);
  });
});
