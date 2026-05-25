import { app, ipcMain } from 'electron';
import { AppStatusSchema, IPC } from '../../shared/ipc-contract';
import { getSchemaVersion } from '../db';

export function registerAppIpc(): void {
  ipcMain.handle(IPC.appGetStatus, () => {
    // Validate our own output against the contract before it crosses the bridge.
    return AppStatusSchema.parse({
      platform: process.platform,
      appVersion: app.getVersion(),
      dbSchemaVersion: getSchemaVersion(),
    });
  });
}
