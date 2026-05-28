import { app, ipcMain, shell } from 'electron';
import { AppStatusSchema, ExternalTargetSchema, IPC } from '../../shared/ipc-contract';
import { getSchemaVersion } from '../db';

// External destinations the renderer can ask main to open (V07). The mapping
// stays in main so the renderer can never pass an arbitrary URL into
// shell.openExternal.
const EXTERNAL_URLS = {
  releases: 'https://github.com/jltps/MeetingTranscriber/releases',
  repo: 'https://github.com/jltps/MeetingTranscriber',
} as const;

export function registerAppIpc(): void {
  ipcMain.handle(IPC.appGetStatus, () => {
    // Validate our own output against the contract before it crosses the bridge.
    return AppStatusSchema.parse({
      platform: process.platform,
      appVersion: app.getVersion(),
      dbSchemaVersion: getSchemaVersion(),
    });
  });

  ipcMain.handle(IPC.appOpenExternal, async (_event, raw) => {
    const target = ExternalTargetSchema.parse(raw);
    await shell.openExternal(EXTERNAL_URLS[target]);
  });
}
