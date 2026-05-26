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
 * Ensure the model cache directory exists. Called at app startup.
 *
 * The @xenova/transformers `env` is configured lazily in loadTransformers()
 * rather than here: the package is ESM-only, so it must be reached via a
 * dynamic import() (a static import gets down-levelled to require() by the CJS
 * main bundle and crashes at load — ERR_REQUIRE_ESM).
 */
export function initTransformersCache(): void {
  fs.mkdirSync(getModelsDir(), { recursive: true });
}

/** True once env.cacheDir/allowLocalModels have been applied (idempotent guard). */
let envConfigured = false;

/**
 * Lazy-load @xenova/transformers and configure its cache exactly once.
 * Every pipeline call (download + inference) goes through this so the cacheDir
 * is guaranteed to be set before the first model load, without a startup race.
 */
export async function loadTransformers(): Promise<typeof import('@xenova/transformers')> {
  const transformers = await import('@xenova/transformers');
  if (!envConfigured) {
    const dir = getModelsDir();
    fs.mkdirSync(dir, { recursive: true });
    // Tell transformers.js to cache here instead of ~/.cache/huggingface
    transformers.env.cacheDir = dir;
    // Allow downloads from the CDN (default: true)
    transformers.env.allowRemoteModels = true;
    // Disable local file scanning for security — we always go through the cache
    transformers.env.allowLocalModels = false;
    envConfigured = true;
  }
  return transformers;
}

// ── Model status ──────────────────────────────────────────────────────────────

/**
 * Absolute path to a model's cache directory.
 *
 * @xenova/transformers' FileCache mirrors the repo id verbatim as nested
 * directories — {cacheDir}/{org}/{model}/... (e.g. Xenova/whisper-tiny) — NOT
 * a flattened `org--model`. path.join handles the '/' on every platform.
 */
function getModelDir(name: WhisperModelName): string {
  return path.join(getModelsDir(), ...CATALOGUE[name].hfId.split('/'));
}

/**
 * Returns true when the key model weight files are present in the cache.
 */
export function isModelDownloaded(name: WhisperModelName): boolean {
  const modelDir = getModelDir(name);
  if (!fs.existsSync(modelDir)) return false;
  // Check for the ONNX encoder file which is the largest / last to download.
  // ASR pipelines default to the quantized variant, but accept either.
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
  // Lazy-load to avoid loading the heavy ONNX runtime at startup, and to keep
  // the ESM-only package off the static require() path (see loadTransformers).
  const { pipeline } = await loadTransformers();

  const hfId = CATALOGUE[name].hfId;

  // Track per-file progress and convert to an overall percentage.
  // transformers.js fires callbacks per file; `info.name` is the repo id (same
  // for every file), so we key on `info.file` — otherwise all files collapse
  // into one entry and the bar jumps. We register each file at 'initiate'/
  // 'download' (0%) so the average reflects files that haven't started yet.
  const fileProgress = new Map<string, number>();

  const report = (file: string | undefined, pct: number): void => {
    if (!file) return;
    fileProgress.set(file, Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0);
    const values = [...fileProgress.values()];
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    onProgress(Math.round(avg));
  };

  await pipeline('automatic-speech-recognition', hfId, {
    progress_callback: (info: {
      status: string;
      name: string;
      file?: string;
      progress?: number;
      loaded?: number;
      total?: number;
    }) => {
      if (signal.aborted) return;
      switch (info.status) {
        case 'initiate':
        case 'download':
          // File discovered but not yet downloading — seed at 0%.
          if (info.file && !fileProgress.has(info.file)) report(info.file, 0);
          break;
        case 'progress':
          report(info.file, info.progress ?? ((info.loaded ?? 0) / (info.total || 1)) * 100);
          break;
        case 'done':
          report(info.file, 100);
          break;
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
  const modelDir = getModelDir(name);
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    logger.info(`Whisper model "${name}" deleted`);
  }
}
