import { describe, it, expect } from 'vitest';
import { UpdateStateSchema } from '../src/shared/ipc-contract';
import {
  mapAvailable,
  mapDownloaded,
  mapDownloadProgress,
  mapError,
  mapNotAvailable,
  normalizeReleaseNotes,
} from '../src/main/updater/state';

describe('state projections', () => {
  it('projects update-available with normalized release notes', () => {
    const out = mapAvailable({
      version: '0.7.1',
      releaseDate: '2026-05-28T12:00:00Z',
      releaseNotes: '  hello  ',
    });
    expect(out).toEqual({
      phase: 'available',
      version: '0.7.1',
      releaseDate: '2026-05-28T12:00:00Z',
      releaseNotes: 'hello',
    });
  });

  it('projects download-progress, clamping percent to [0,100]', () => {
    expect(mapDownloadProgress({ percent: 42 }, '0.7.1')).toEqual({
      phase: 'downloading',
      version: '0.7.1',
      percent: 42,
    });
    expect(mapDownloadProgress({ percent: -5 }, '0.7.1')).toMatchObject({ percent: 0 });
    expect(mapDownloadProgress({ percent: 250 }, '0.7.1')).toMatchObject({ percent: 100 });
  });

  it('projects update-downloaded', () => {
    expect(mapDownloaded({ version: '0.7.1' })).toEqual({
      phase: 'downloaded',
      version: '0.7.1',
    });
  });

  it('projects update-not-available with a checkedAt timestamp', () => {
    const iso = '2026-05-28T12:00:00Z';
    expect(mapNotAvailable(iso)).toEqual({ phase: 'none', checkedAt: iso });
  });

  it('projects errors via Error.message', () => {
    expect(mapError(new Error('socket hang up'))).toEqual({
      phase: 'error',
      message: 'socket hang up',
    });
    expect(mapError('boom')).toEqual({ phase: 'error', message: 'boom' });
  });
});

describe('normalizeReleaseNotes', () => {
  it('returns undefined for null / empty / undefined', () => {
    expect(normalizeReleaseNotes(undefined)).toBeUndefined();
    expect(normalizeReleaseNotes(null)).toBeUndefined();
    expect(normalizeReleaseNotes('')).toBeUndefined();
    expect(normalizeReleaseNotes('   ')).toBeUndefined();
  });

  it('joins the array shape into a single string', () => {
    expect(
      normalizeReleaseNotes([{ note: 'first' }, { note: 'second' }]),
    ).toBe('first\n\nsecond');
  });
});

describe('UpdateStateSchema round-trip', () => {
  it('accepts every variant', () => {
    const variants = [
      { phase: 'idle' },
      { phase: 'checking' },
      { phase: 'available', version: '0.7.1' },
      { phase: 'available', version: '0.7.1', releaseDate: '2026-05-28T12:00:00Z' },
      { phase: 'downloading', version: '0.7.1', percent: 0 },
      { phase: 'downloading', version: '0.7.1', percent: 100 },
      { phase: 'downloaded', version: '0.7.1' },
      { phase: 'none', checkedAt: '2026-05-28T12:00:00Z' },
      { phase: 'error', message: 'boom' },
    ];
    for (const v of variants) {
      expect(() => UpdateStateSchema.parse(v)).not.toThrow();
    }
  });

  it('rejects unknown phases', () => {
    expect(() => UpdateStateSchema.parse({ phase: 'bogus' })).toThrow();
  });

  it('rejects out-of-range percent', () => {
    expect(() =>
      UpdateStateSchema.parse({ phase: 'downloading', version: '0.7.1', percent: 150 }),
    ).toThrow();
  });
});
