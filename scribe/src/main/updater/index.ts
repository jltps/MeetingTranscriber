// Main-process auto-updater wired to GitHub Releases via electron-updater
// (V07 block 01). The renderer can only request actions through IPC; this
// module owns the state machine, the periodic timer, and the install gate.
//
// §1 invariants: no audio is touched (§1.1); the GitHub provider is anonymous
// against a public repo, so no API key is needed and none is stored (§1.2);
// every IPC call is Zod-validated in main (§1.3); install is refused while a
// transcription session is active, so user notes are never lost (§1.5).
import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC } from '../../shared/ipc-contract';
import type { UpdateState } from '../../shared/ipc-contract';
import { logger } from '../logger';
import { getAutoUpdateEnabled, setUpdateLastChecked } from '../db/settings';
import { canInstallNow } from './install-guard';
import {
  mapAvailable,
  mapDownloaded,
  mapDownloadProgress,
  mapError,
  mapNotAvailable,
} from './state';

// Delay the boot-time check so the first window has a chance to render before
// the network activity. 6h periodic cadence matches Slack/Discord-class clients.
const BOOT_CHECK_DELAY_MS = 60_000;
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let currentState: UpdateState = { phase: 'idle' };
// electron-updater's download-progress event has no version; remember the last
// version we saw on `update-available` so progress events can carry it.
let downloadingVersion: string | null = null;
let bootTimer: NodeJS.Timeout | null = null;
let periodicTimer: NodeJS.Timeout | null = null;
let initialized = false;

function broadcast(state: UpdateState): void {
  currentState = state;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.updateStatus, state);
    }
  }
}

export function getCurrentUpdateState(): UpdateState {
  return currentState;
}

export async function checkNow(): Promise<{ ok: boolean; error?: string }> {
  if (!app.isPackaged) return { ok: false, error: 'updater disabled in dev' };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    broadcast({ phase: 'error', message });
    return { ok: false, error: message };
  }
}

export type InstallNowResult =
  | { ok: true }
  | { ok: false; reason: 'recording' | 'not-downloaded' | 'error'; message?: string };

export function installNow(): InstallNowResult {
  if (currentState.phase !== 'downloaded') {
    return { ok: false, reason: 'not-downloaded' };
  }
  const guard = canInstallNow();
  if (!guard.ok) return { ok: false, reason: guard.reason };
  try {
    // Silent install + relaunch. Requires `nsis.oneClick: true` (electron-builder.yml).
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'error', message };
  }
}

export function initUpdater(): void {
  if (initialized) return;
  initialized = true;
  if (!app.isPackaged) {
    logger.info('updater disabled in dev');
    return;
  }
  // We own install timing so the recording guard can fire; auto-download is fine.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    broadcast({ phase: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    downloadingVersion = info.version;
    broadcast(mapAvailable(info));
    setUpdateLastChecked(new Date().toISOString());
    logger.info('update available', info.version);
  });
  autoUpdater.on('update-not-available', () => {
    const now = new Date().toISOString();
    setUpdateLastChecked(now);
    broadcast(mapNotAvailable(now));
  });
  autoUpdater.on('download-progress', (p) => {
    broadcast(mapDownloadProgress(p, downloadingVersion ?? ''));
  });
  autoUpdater.on('update-downloaded', (info) => {
    downloadingVersion = info.version;
    broadcast(mapDownloaded(info));
    logger.info('update downloaded', info.version);
  });
  autoUpdater.on('error', (err) => {
    broadcast(mapError(err));
    logger.warn('updater error', err instanceof Error ? err.message : String(err));
  });

  if (getAutoUpdateEnabled()) {
    bootTimer = setTimeout(() => {
      void checkNow();
    }, BOOT_CHECK_DELAY_MS);
    periodicTimer = setInterval(() => {
      void checkNow();
    }, PERIODIC_CHECK_INTERVAL_MS);
  }
}

export function disposeUpdater(): void {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  if (initialized && app.isPackaged) {
    autoUpdater.removeAllListeners();
  }
  initialized = false;
}
