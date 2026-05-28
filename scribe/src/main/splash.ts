import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { effectiveTheme, initialBackgroundColor } from './theme';

// Static asset path. In dev __dirname is out/main, so the build/ folder lives
// two levels up. In packaged builds we ship splash.html as an extraResource
// next to icon.png (process.resourcesPath/splash.html — wired in
// electron-builder.yml).
const splashHtml = process.env.ELECTRON_RENDERER_URL
  ? join(__dirname, '../../build/splash.html')
  : join(process.resourcesPath, 'splash.html');

/**
 * Frameless transparent splash window shown immediately on app.whenReady,
 * dismissed when the main window emits ready-to-show (V072 block 01). The
 * splash is a static HTML island — no preload, no IPC, no network — so it
 * cannot violate §1.2 / §1.3 (no keys, renderer untrusted).
 */
export function createSplash(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 220,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: true,
    backgroundColor: initialBackgroundColor(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const url = pathToFileURL(splashHtml);
  url.searchParams.set('theme', effectiveTheme());
  void win.loadURL(url.toString());
  return win;
}

export function closeSplash(win: BrowserWindow): void {
  if (!win.isDestroyed()) win.destroy();
}
