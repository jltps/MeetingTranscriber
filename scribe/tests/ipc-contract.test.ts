import { describe, it, expect } from 'vitest';
import { AppStatusSchema } from '../src/shared/ipc-contract';

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
