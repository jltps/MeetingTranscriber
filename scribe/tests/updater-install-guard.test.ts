import { describe, it, expect } from 'vitest';
import { canInstallNow } from '../src/main/updater/install-guard';

describe('canInstallNow', () => {
  it('refuses install while a transcription session is active', () => {
    expect(canInstallNow({ getActive: () => true })).toEqual({
      ok: false,
      reason: 'recording',
    });
  });

  it('allows install when no session is active', () => {
    expect(canInstallNow({ getActive: () => false })).toEqual({ ok: true });
  });
});
