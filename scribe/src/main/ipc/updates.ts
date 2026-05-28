import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC } from '../../shared/ipc-contract';
import type { UpdateSettings } from '../../shared/ipc-contract';
import {
  checkNow,
  getCurrentUpdateState,
  installNow,
} from '../updater';
import {
  getAutoUpdateEnabled,
  getUpdateLastChecked,
  setAutoUpdateEnabled,
} from '../db/settings';

// Renderer-facing surface for the auto-updater (V07 block 01). All handlers
// validate their inputs against Zod schemas (CLAUDE.md §4) even when the
// payload is empty — keeps the discipline uniform.
export function registerUpdatesIpc(): void {
  ipcMain.handle(IPC.updateCheckNow, async () => {
    return await checkNow();
  });

  ipcMain.handle(IPC.updateInstall, () => {
    return installNow();
  });

  ipcMain.handle(IPC.updateGetState, () => {
    return getCurrentUpdateState();
  });

  ipcMain.handle(IPC.updateGetSettings, (): UpdateSettings => {
    return {
      autoEnabled: getAutoUpdateEnabled(),
      lastChecked: getUpdateLastChecked(),
    };
  });

  const SetAutoSchema = z.boolean();
  ipcMain.handle(IPC.updateSetAutoEnabled, (_event, raw) => {
    setAutoUpdateEnabled(SetAutoSchema.parse(raw));
  });
}
