/**
 * V08 — Gladia init-config builder + language mapping (pure parts of gladia.ts).
 * The §1.7 invariant: a fixed language maps to its ISO-639-1 code; auto (or an
 * unmappable code) leaves `languages` empty so Gladia auto-detects — never a
 * hardcoded English default.
 */
import { describe, it, expect } from 'vitest';
import { buildGladiaConfig, toIso639_1 } from '../src/main/transcription/gladia';

describe('toIso639_1', () => {
  it('strips region and lowercases', () => {
    expect(toIso639_1('pt-PT')).toBe('pt');
    expect(toIso639_1('EN-us')).toBe('en');
    expect(toIso639_1('es')).toBe('es');
  });
  it('returns null for unmappable input', () => {
    expect(toIso639_1('')).toBeNull();
    expect(toIso639_1('x')).toBeNull();
  });
});

describe('buildGladiaConfig', () => {
  it('uses solaria-1 / wav-pcm / 16-bit and enables NER + sentiment', () => {
    const cfg = buildGladiaConfig({ sampleRate: 16000, channels: 1 });
    expect(cfg.model).toBe('solaria-1');
    expect(cfg.encoding).toBe('wav/pcm');
    expect(cfg.bit_depth).toBe(16);
    expect(cfg.realtime_processing).toEqual({
      named_entity_recognition: true,
      sentiment_analysis: true,
    });
    expect(cfg.messages_config?.receive_partial_transcripts).toBe(true);
  });

  it('auto language → empty languages + code_switching (never default English)', () => {
    const cfg = buildGladiaConfig({ sampleRate: 16000, channels: 1 }, { mode: 'auto' });
    expect(cfg.language_config).toEqual({ languages: [], code_switching: true });
  });

  it('fixed language maps BCP-47 → ISO-639-1', () => {
    const cfg = buildGladiaConfig({ sampleRate: 16000, channels: 1 }, { mode: 'fixed', bcp47: 'pt-PT' });
    expect(cfg.language_config).toEqual({ languages: ['pt'] });
  });

  it('unmappable fixed language falls back to auto-detect, not English', () => {
    const cfg = buildGladiaConfig({ sampleRate: 16000, channels: 1 }, { mode: 'fixed', bcp47: '' });
    expect(cfg.language_config).toEqual({ languages: [], code_switching: true });
  });

  it('coerces an unsupported sample rate to 16000', () => {
    expect(buildGladiaConfig({ sampleRate: 12345, channels: 1 }).sample_rate).toBe(16000);
    expect(buildGladiaConfig({ sampleRate: 48000, channels: 2 }).sample_rate).toBe(48000);
  });
});
