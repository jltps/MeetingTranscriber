import { describe, it, expect } from 'vitest';
import { AppStatusSchema, TranscriptionStatusSchema } from '../src/shared/ipc-contract';

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
