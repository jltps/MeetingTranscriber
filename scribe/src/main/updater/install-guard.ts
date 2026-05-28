// Refuses to quitAndInstall while a transcription session is active (V07
// block 01). Keeps the user's notes sacred (§1.5): we never restart mid-meeting
// and lose live transcript state.
import { isTranscriptionActive } from '../ipc/transcription';

export type CanInstallResult = { ok: true } | { ok: false; reason: 'recording' };

export type CanInstallDeps = {
  /** Override for tests. In prod this defaults to the transcription module's accessor. */
  getActive?: () => boolean;
};

export function canInstallNow(deps: CanInstallDeps = {}): CanInstallResult {
  const active = (deps.getActive ?? isTranscriptionActive)();
  if (active) return { ok: false, reason: 'recording' };
  return { ok: true };
}
