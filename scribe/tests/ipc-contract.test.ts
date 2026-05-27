import { describe, it, expect } from 'vitest';
import {
  AppStatusSchema,
  LlmProviderSchema,
  OpenAiConfigSchema,
  OptimizeTemplateSchema,
  OptimizeTemplateResultSchema,
  QualityModeSchema,
  TranscriptionStatusSchema,
} from '../src/shared/ipc-contract';

describe('AppStatusSchema', () => {
  it('accepts a valid status payload', () => {
    const value = { platform: 'win32', appVersion: '0.1.0', dbSchemaVersion: 1 };
    expect(AppStatusSchema.parse(value)).toEqual(value);
  });

  it('rejects a non-integer schema version', () => {
    expect(() =>
      AppStatusSchema.parse({ platform: 'win32', appVersion: '0.1.0', dbSchemaVersion: 1.5 }),
    ).toThrow();
  });

  it('rejects a payload missing required fields', () => {
    expect(() => AppStatusSchema.parse({ platform: 'win32' })).toThrow();
  });
});

describe('TranscriptionStatusSchema', () => {
  it('accepts all four valid states', () => {
    for (const state of ['open', 'closed', 'error', 'reconnecting'] as const) {
      expect(() => TranscriptionStatusSchema.parse({ state })).not.toThrow();
    }
  });

  it('accepts a message with the payload', () => {
    expect(TranscriptionStatusSchema.parse({ state: 'reconnecting', message: 'Attempt 1 of 5…' }))
      .toEqual({ state: 'reconnecting', message: 'Attempt 1 of 5…' });
  });

  it('rejects an unknown state', () => {
    expect(() => TranscriptionStatusSchema.parse({ state: 'unknown' })).toThrow();
  });
});

describe('OptimizeTemplateSchema (V06 block 02)', () => {
  it('accepts instructions alone and with an optional name', () => {
    expect(OptimizeTemplateSchema.parse({ instructions: 'rough notes' })).toEqual({
      instructions: 'rough notes',
    });
    expect(
      OptimizeTemplateSchema.parse({ instructions: 'rough', name: 'Sales call' }),
    ).toEqual({ instructions: 'rough', name: 'Sales call' });
  });

  it('rejects empty instructions and over-length input', () => {
    expect(() => OptimizeTemplateSchema.parse({ instructions: '' })).toThrow();
    expect(() => OptimizeTemplateSchema.parse({ instructions: 'x'.repeat(4001) })).toThrow();
    expect(() =>
      OptimizeTemplateSchema.parse({ instructions: 'ok', name: 'y'.repeat(101) }),
    ).toThrow();
  });

  it('round-trips a result payload', () => {
    expect(OptimizeTemplateResultSchema.parse({ instructions: 'clean guidance' })).toEqual({
      instructions: 'clean guidance',
    });
  });
});

describe('QualityModeSchema (V06 block 04)', () => {
  it('accepts the two modes and rejects anything else', () => {
    expect(QualityModeSchema.parse('economy')).toBe('economy');
    expect(QualityModeSchema.parse('quality')).toBe('quality');
    expect(() => QualityModeSchema.parse('balanced')).toThrow();
  });
});

describe('LlmProviderSchema (V06 block 05)', () => {
  it('accepts the two providers and rejects anything else', () => {
    expect(LlmProviderSchema.parse('anthropic')).toBe('anthropic');
    expect(LlmProviderSchema.parse('openai-compatible')).toBe('openai-compatible');
    expect(() => LlmProviderSchema.parse('gemini')).toThrow();
  });
});

describe('OpenAiConfigSchema (V06 block 05)', () => {
  it('accepts a valid config with and without a key', () => {
    expect(OpenAiConfigSchema.parse({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' })).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    });
    expect(
      OpenAiConfigSchema.parse({ baseUrl: 'https://x.test/v1', model: 'm', key: 'sk-x' }),
    ).toMatchObject({ key: 'sk-x' });
  });

  it('rejects a non-URL base URL or empty model', () => {
    expect(() => OpenAiConfigSchema.parse({ baseUrl: 'not-a-url', model: 'gpt-4o' })).toThrow();
    expect(() => OpenAiConfigSchema.parse({ baseUrl: 'https://x.test/v1', model: '' })).toThrow();
  });
});
