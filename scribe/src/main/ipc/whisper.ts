/**
 * Whisper model management IPC handlers (ROADMAP_05).
 *
 * Covers: model status list, download (with progress push), cancel, delete.
 * All operations are in the main process; the renderer only sees status updates
 * via the typed bridge — no Node APIs cross the context boundary (CLAUDE.md §3).
 */
import { ipcMain, BrowserWindow } from 'electron';
import { IPC, WhisperModelNameSchema } from '../../shared/ipc-contract';
import type { WhisperModelStatus, WhisperDownloadProgress } from '../../shared/ipc-contract';
import {
  getModelStatuses,
  downloadModel,
  deleteModel,
  createDownloadAbortController,
  cancelDownload,
  initTransformersCache,
} from '../transcription/whisper-models';
import { logger } from '../logger';

/** Push a download progress event to the focused window (same pattern as transcription segments). */
function pushProgress(payload: WhisperDownloadProgress): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(
    IPC.whisperModelDownloadProgress,
    payload,
  );
}

export function registerWhisperIpc(): void {
  // Call initTransformersCache here so the cacheDir is set before any pipeline call.
  initTransformersCache();

  // whisper:modelsGet → WhisperModelStatus[]
  ipcMain.handle(IPC.whisperModelsGet, (): WhisperModelStatus[] => {
    return getModelStatuses();
  });

  // whisper:modelDownload (name) → void
  // Triggers async download; progress is pushed via whisper:modelDownloadProgress.
  ipcMain.handle(IPC.whisperModelDownload, async (_event, raw) => {
    const name = WhisperModelNameSchema.parse(raw);
    const controller = createDownloadAbortController();

    try {
      await downloadModel(
        name,
        (pct) => {
          pushProgress({ name, pct, done: false });
        },
        controller.signal,
      );
      pushProgress({ name, pct: 100, done: true });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted) {
        logger.info(`Whisper model download cancelled: ${name}`);
        pushProgress({ name, pct: 0, done: true, error: 'Cancelled' });
      } else {
        logger.error(`Whisper model download failed: ${name}`, err instanceof Error ? err : new Error(String(err)));
        pushProgress({ name, pct: 0, done: true, error: errorMsg });
      }
    }
  });

  // whisper:modelCancel → void
  ipcMain.handle(IPC.whisperModelCancel, () => {
    cancelDownload();
  });

  // whisper:modelDelete (name) → void
  ipcMain.handle(IPC.whisperModelDelete, (_event, raw) => {
    const name = WhisperModelNameSchema.parse(raw);
    deleteModel(name);
  });
}
