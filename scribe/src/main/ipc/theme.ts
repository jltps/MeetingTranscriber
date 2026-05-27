import { ipcMain } from 'electron';
import { IPC, ThemeModeSchema } from '../../shared/ipc-contract';
import type { ThemeView } from '../../shared/ipc-contract';
import { applyThemeMode, themeView } from '../theme';

// Appearance / theming IPC (ROADMAP_V04_01). The renderer never applies colours
// itself — main owns nativeTheme.themeSource and the renderer reflects it via
// prefers-color-scheme — so these two channels are the whole surface.
export function registerThemeIpc(): void {
  ipcMain.handle(IPC.themeGet, (): ThemeView => themeView());

  ipcMain.handle(IPC.themeSet, (_event, raw): ThemeView => {
    return applyThemeMode(ThemeModeSchema.parse(raw));
  });
}
