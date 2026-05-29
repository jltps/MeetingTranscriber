import { describe, it, expect } from 'vitest';
import { buildDeepgramQuery } from '../src/main/transcription/deepgram';

const base = { sampleRate: 16000, channels: 1 };

describe('buildDeepgramQuery', () => {
  it('always sets the core nova-3 streaming params', () => {
    const p = buildDeepgramQuery(base);
    expect(p.get('model')).toBe('nova-3');
    expect(p.get('diarize')).toBe('true');
    expect(p.get('smart_format')).toBe('true');
    expect(p.get('punctuate')).toBe('true');
    expect(p.get('interim_results')).toBe('true');
    expect(p.get('encoding')).toBe('linear16');
    expect(p.get('sample_rate')).toBe('16000');
    expect(p.get('channels')).toBe('1');
  });

  // V075 ROADMAP_01: paragraphs=true returns Deepgram's diarization-aware
  // paragraph block, used by groupAttributedWords to collapse fragmented
  // remote-speaker runs.
  it('always sets paragraphs=true (V075)', () => {
    expect(buildDeepgramQuery(base).get('paragraphs')).toBe('true');
    expect(buildDeepgramQuery({ ...base, channels: 2 }).get('paragraphs')).toBe('true');
  });

  // Regression guard: `diarize_model` is pre-recorded only and returns HTTP 400
  // on streaming (Deepgram docs, May 2026). Streaming stays on diarize=true.
  it('NEVER sets diarize_model (streaming returns HTTP 400)', () => {
    expect(buildDeepgramQuery(base).has('diarize_model')).toBe(false);
    expect(buildDeepgramQuery(base, { mode: 'auto' }).has('diarize_model')).toBe(false);
  });

  // Regression guard: nova-3 streaming rejects detect_language with HTTP 400 (V05).
  it('NEVER uses detect_language', () => {
    expect(buildDeepgramQuery(base, { mode: 'auto' }).has('detect_language')).toBe(false);
    expect(buildDeepgramQuery({ ...base, channels: 2 }, { mode: 'auto' }).has('detect_language')).toBe(
      false,
    );
  });

  it('auto mode → language=multi (nova-3 has no streaming language detection)', () => {
    expect(buildDeepgramQuery(base, { mode: 'auto' }).get('language')).toBe('multi');
  });

  it('fixed mode → the BCP-47 code passed through', () => {
    expect(buildDeepgramQuery(base, { mode: 'fixed', bcp47: 'pt-PT' }).get('language')).toBe('pt-PT');
    expect(buildDeepgramQuery(base, { mode: 'fixed', bcp47: 'en-US' }).get('language')).toBe('en-US');
  });

  it('defaults to fixed English when no language setting is given', () => {
    expect(buildDeepgramQuery(base).get('language')).toBe('en');
  });

  it('omits multichannel for the mono (V05) path and sets it only for ≥2 channels', () => {
    expect(buildDeepgramQuery({ ...base, channels: 1 }).has('multichannel')).toBe(false);
    expect(buildDeepgramQuery({ ...base, channels: 2 }).get('multichannel')).toBe('true');
  });
});
