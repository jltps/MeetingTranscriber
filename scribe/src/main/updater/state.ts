// Pure projections from electron-updater event payloads to the wire UpdateState
// the renderer consumes. Kept separate from index.ts so they're unit-testable
// without spinning the real autoUpdater (V07 block 01).
import type { UpdateState } from '../../shared/ipc-contract';

/** Minimal shape electron-updater emits on `update-available` / `update-downloaded`. */
export type UpdateInfoLike = {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | null | { note: string | null }[];
};

/** Minimal shape electron-updater emits on `download-progress`. */
export type ProgressLike = {
  percent: number;
};

/** Coerce electron-updater's release-notes union (string | array | null) into a single string. */
export function normalizeReleaseNotes(notes: UpdateInfoLike['releaseNotes']): string | undefined {
  if (!notes) return undefined;
  if (typeof notes === 'string') return notes.trim() || undefined;
  if (Array.isArray(notes)) {
    const joined = notes
      .map((n) => n.note ?? '')
      .filter(Boolean)
      .join('\n\n')
      .trim();
    return joined || undefined;
  }
  return undefined;
}

export function mapAvailable(info: UpdateInfoLike): UpdateState {
  return {
    phase: 'available',
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
  };
}

export function mapDownloadProgress(p: ProgressLike, version: string): UpdateState {
  const percent = Number.isFinite(p.percent) ? Math.max(0, Math.min(100, p.percent)) : 0;
  return { phase: 'downloading', version, percent };
}

export function mapDownloaded(info: UpdateInfoLike): UpdateState {
  return {
    phase: 'downloaded',
    version: info.version,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
  };
}

export function mapNotAvailable(checkedAt: string): UpdateState {
  return { phase: 'none', checkedAt };
}

export function mapError(err: unknown): UpdateState {
  const message = err instanceof Error ? err.message : String(err);
  return { phase: 'error', message };
}
