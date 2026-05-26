/**
 * Whisper model management for local transcription (ROADMAP_05).
 *
 * Models are ONNX files downloaded and cached by @xenova/transformers.
 * Cache lives in `userData/whisper-models` — never in the app bundle.
 *
 * §1.1 invariant: this file downloads *model weights* only, never audio data.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
// env is the transformers.js global configuration object.
// We set cacheDir and allowLocalModels before any pipeline call.
import { env } from '@xenova/transformers';
import { logger } from '../logger';

// ── Model catalogue ───────────────────────────────────────────────────────────

export type WhisperModelName = 'tiny' | 'base' | 'small' | 'medium';

export type WhisperModelStatus = {
  name: WhisperModelName;
  /** Expected download size in bytes (approximate, ONNX encoder + decoder). */
  sizeBytes: number;
  state: 'not-downloaded' | 'downloading' | 'ready';
  /** 0-100 while downloading, undefined otherwise. */
  progress?: number;
};

const CATALOGUE: Record<
  WhisperModelName,
  { sizeBytes: number; hfId: string }
> = {
  tiny:   { sizeBytes:    77_000_000, hfId: 'Xenova/whisper-tiny' },
  base:   { sizeBytes:   145_000_000, hfId: 'Xenova/whisper-base' },
  small:  { sizeBytes:   480_000_000, hfId: 'Xenova/whisper-small' },
  medium: { sizeBytes: 1_500_000_000, hfId: 'Xenova/whisper-medium' },
};

export const WHISPER_MODEL_NAMES = Object.keys(CATALOGUE) as WhisperModelName[];

// ── Cache directory ───────────────────────────────────────────────────────────

/** Absolute path to the directory where model ONNX files are cached. */
export function getModelsDir(): string {
  return path.join(app.getPath('userData'), 'whisper-models');
}

/**
 * Configure @xenova/transformers to use our userData cache.
 * Called once at app startup (from registerWhisperIpc).
 */
export function initTransformersCache(): void {
  const dir = getModelsDir();
  fs.mkdirSync(dir, { recursive: true });
  // Tell transformers.js to cache here instead of ~/.cache/huggingface
  env.cacheDir = dir;
  // Allow downloads from the CDN (default: true)
  env.allowRemoteModels = true;
  // Disable local file scanning for security — we always go through the cache
  env.allowLocalModels = false;
}

// ── Model status ──────────────────────────────────────────────────────────────

/**
 * Returns true when the key model weight files are present in the cache.
 * @xenova/transformers stores Hugging Face repos as sub-directories named
 * after the model id (slashes replaced by --), so we check for the directory.
 */
export function isModelDownloaded(name: WhisperModelName): boolean {
  const dir = getModelsDir();
  const hfId = CATALOGUE[name].hfId;
  // transformers.js mirrors: {cacheDir}/{org}--{model}/...
  const safeId = hfId.replace('/', '--');
  const modelDir = path.join(dir, safeId);
  if (!fs.existsSync(modelDir)) return false;
  // Check for the ONNX encoder file which is the largest / last to download
  const encoderPath = path.join(modelDir, 'onnx', 'encoder_model.onnx');
  const encoderQuantPath = path.join(modelDir, 'onnx', 'encoder_model_quantized.onnx');
  return fs.existsSync(encoderPath) || fs.existsSync(encoderQuantPath);
}

export function getModelStatuses(): WhisperModelStatus[] {
  return WHISPER_MODEL_NAMES.map((name) => ({
    name,
    sizeBytes: CATALOGUE[name].sizeBytes,
    state: isModelDownloaded(name) ? 'ready' : 'not-downloaded',
  }));
}

export function getHfId(name: WhisperModelName): string {
  return CATALOGUE[name].hfId;
}

// ── Download ──────────────────────────────────────────────────────────────────

/** Active download controller — only one download at a time. */
let activeAbortController: AbortController | null = null;

/**
 * Download and cache a Whisper model.
 *
 * Uses @xenova/transformers `pipeline()` with a progress callback so we can
 * report 0-100 back to the UI. The model stays cached at `getModelsDir()`.
 *
 * @param onProgress  Called with 0-100 as files download.
 * @param signal      Abort to cancel. On abort a partial cache dir is left and
 *                    cleaned up on the next call or app restart.
 */
export async function downloadModel(
  name: WhisperModelName,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<void> {
  // Lazy-import to avoid loading the heavy ONNX runtime at startup.
  const { pipeline } = await import('@xenova/transformers');

  const hfId = CATALOGUE[name].hfId;

  // Track per-file progress and convert to an overall percentage.
  // transformers.js fires callbacks per file; aggregate them into one value.
  const fileProgress = new Map<string, number>();

  await pipeline('automatic-speech-recognition', hfId, {
    progress_callback: (info: {
      status: string;
      name: string;
      progress?: number;
      loaded?: number;
      total?: number;
    }) => {
      if (signal.aborted) return;
      if (info.status === 'progress' && info.name) {
        const pct = info.progress ?? ((info.loaded ?? 0) / (info.total ?? 1)) * 100;
        fileProgress.set(info.name, pct);
        // Overall = average of all known files
        const values = [...fileProgress.values()];
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        onProgress(Math.round(avg));
      } else if (info.status === 'done') {
        fileProgress.set(info.name, 100);
        const values = [...fileProgress.values()];
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        onProgress(Math.round(avg));
      }
    },
  });

  if (signal.aborted) {
    throw new Error('Download cancelled');
  }

  onProgress(100);
  logger.info(`Whisper model "${name}" downloaded and cached`);
}

export function cancelDownload(): void {
  activeAbortController?.abort();
  activeAbortController = null;
}

export function createDownloadAbortController(): AbortController {
  activeAbortController?.abort(); // cancel any existing download
  activeAbortController = new AbortController();
  return activeAbortController;
}

// ── Delete ────────────────────────────────────────────────────────────────────

export function deleteModel(name: WhisperModelName): void {
  const dir = getModelsDir();
  const hfId = CATALOGUE[name].hfId;
  const safeId = hfId.replace('/', '--');
  const modelDir = path.join(dir, safeId);
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    logger.info(`Whisper model "${name}" deleted`);
  }
}
