import { describe, it, expect } from 'vitest';
import {
  claudeTokenCost,
  estimateCost,
  formatCost,
  formatAudioDuration,
  PRICING,
} from '../src/shared/pricing';

describe('claudeTokenCost (V06 block 04 tiered pricing)', () => {
  it('prices Sonnet tokens at the Sonnet rate', () => {
    expect(claudeTokenCost(1_000_000, 1_000_000, 'sonnet')).toBeCloseTo(
      PRICING.claudeSonnetInputPer1MTokens + PRICING.claudeSonnetOutputPer1MTokens,
      6,
    );
  });

  it('prices Haiku tokens at the cheaper Haiku rate', () => {
    expect(claudeTokenCost(1_000_000, 1_000_000, 'haiku')).toBeCloseTo(
      PRICING.claudeHaikuInputPer1MTokens + PRICING.claudeHaikuOutputPer1MTokens,
      6,
    );
    // Haiku must be cheaper than Sonnet for the same tokens.
    expect(claudeTokenCost(1000, 1000, 'haiku')).toBeLessThan(claudeTokenCost(1000, 1000, 'sonnet'));
  });
});

describe('estimateCost', () => {
  it('returns 0 for no usage', () => {
    expect(estimateCost(0, 0, 0)).toBe(0);
  });

  it('calculates Deepgram cost correctly (2-channel billing)', () => {
    // 60 000 ms = 1 minute × 2 channels × $0.0059/min
    const cost = estimateCost(60_000, 0, 0);
    expect(cost).toBeCloseTo(2 * PRICING.deepgramNovaPerMinutePerChannel, 6);
  });

  it('calculates Claude input token cost correctly', () => {
    // 1 million input tokens
    const cost = estimateCost(0, 1_000_000, 0);
    expect(cost).toBeCloseTo(PRICING.claudeSonnetInputPer1MTokens, 6);
  });

  it('calculates Claude output token cost correctly', () => {
    // 1 million output tokens
    const cost = estimateCost(0, 0, 1_000_000);
    expect(cost).toBeCloseTo(PRICING.claudeSonnetOutputPer1MTokens, 6);
  });

  it('sums all cost components', () => {
    const deepgramMs = 120_000; // 2 min
    const inputTokens = 500_000;
    const outputTokens = 100_000;
    const expected =
      (deepgramMs / 1000 / 60) * 2 * PRICING.deepgramNovaPerMinutePerChannel +
      (inputTokens / 1_000_000) * PRICING.claudeSonnetInputPer1MTokens +
      (outputTokens / 1_000_000) * PRICING.claudeSonnetOutputPer1MTokens;
    expect(estimateCost(deepgramMs, inputTokens, outputTokens)).toBeCloseTo(expected, 6);
  });

  it('halves the Deepgram cost for single-channel (mono) capture (V05 ROADMAP_02)', () => {
    const ms = 60_000; // 1 min
    const mono = estimateCost(ms, 0, 0, 1);
    const stereo = estimateCost(ms, 0, 0, 2);
    expect(mono).toBeCloseTo(PRICING.deepgramNovaPerMinutePerChannel, 6);
    expect(mono).toBeCloseTo(stereo / 2, 6);
  });

  it('defaults to 2-channel billing when channels is omitted (legacy meetings)', () => {
    expect(estimateCost(60_000, 0, 0)).toBeCloseTo(estimateCost(60_000, 0, 0, 2), 6);
  });
});

describe('formatCost', () => {
  it('shows "< $0.01" for tiny amounts', () => {
    expect(formatCost(0)).toBe('< $0.01');
    expect(formatCost(0.004)).toBe('< $0.01');
  });

  it('formats larger amounts with 2 decimal places', () => {
    expect(formatCost(0.123)).toBe('$0.12');
    expect(formatCost(1.5)).toBe('$1.50');
  });
});

describe('formatAudioDuration', () => {
  it('shows seconds when under 1 minute', () => {
    expect(formatAudioDuration(30_000)).toBe('30s');
    expect(formatAudioDuration(0)).toBe('0s');
  });

  it('shows minutes and seconds for longer durations', () => {
    expect(formatAudioDuration(90_000)).toBe('1m 30s');
    expect(formatAudioDuration(3_600_000)).toBe('60m 0s');
  });
});

describe('PCM audio duration arithmetic', () => {
  // Mirrors the computation in ipc/transcription.ts:
  // audioMs += (buf.byteLength / 2 / channels / sampleRate) * 1000
  it('computes duration for a 1-second PCM buffer at 16kHz 2ch', () => {
    const sampleRate = 16_000;
    const channels = 2;
    // 1 second of audio = sampleRate * channels * 2 bytes
    const byteLength = sampleRate * channels * 2;
    const durationMs = (byteLength / 2 / channels / sampleRate) * 1000;
    expect(durationMs).toBe(1000);
  });

  it('correctly handles partial buffers', () => {
    const sampleRate = 16_000;
    const channels = 2;
    // 100 ms worth of audio
    const byteLength = Math.round((sampleRate * channels * 2) / 10);
    const durationMs = (byteLength / 2 / channels / sampleRate) * 1000;
    expect(durationMs).toBeCloseTo(100, 0);
  });

  it('computes wall-clock duration for a 1-channel (mono) buffer at 16kHz (V05)', () => {
    const sampleRate = 16_000;
    const channels = 1;
    // 1 second of mono audio = sampleRate * 1 * 2 bytes
    const byteLength = sampleRate * channels * 2;
    const durationMs = (byteLength / 2 / channels / sampleRate) * 1000;
    expect(durationMs).toBe(1000); // duration is wall-clock regardless of channel count
  });
});
