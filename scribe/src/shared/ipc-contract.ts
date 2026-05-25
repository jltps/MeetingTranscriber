// The single source of truth for every IPC channel (CLAUDE.md §4).
// Each channel is declared once here with a Zod schema for its response (and
// request, when it carries one). ipcMain handlers validate against these before
// acting; the preload bridge wires window.api methods to these channel names.
import { z } from 'zod';

export const IPC = {
  appGetStatus: 'app:getStatus',
} as const;

export const AppStatusSchema = z.object({
  platform: z.string(),
  appVersion: z.string(),
  dbSchemaVersion: z.number().int(),
});
export type AppStatus = z.infer<typeof AppStatusSchema>;

/** The typed surface exposed to the renderer as window.api. */
export interface ScribeApi {
  getStatus(): Promise<AppStatus>;
}
