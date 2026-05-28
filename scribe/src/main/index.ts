import { app, BrowserWindow, Menu, session } from 'electron';
import { join } from 'node:path';
import { setupAudioCapture } from './audio/loopback';
import { stopCalendarSync } from './calendar';
import { initDb, closeDb } from './db';
import { registerIpcHandlers } from './ipc';
import { disposeTranscription } from './ipc/transcription';
import { logger } from './logger';
import { disposeUpdater, initUpdater } from './updater';
import { initTheme, initialBackgroundColor, overlayConfig, registerThemeWindow } from './theme';
import { initialWindowBounds, MIN_SIZE, registerWindowState } from './window-state';

// electron-vite sets this only in dev (renderer served by the Vite dev server).
const devUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = !!devUrl;

// Lets the e2e smoke test point at a throwaway userData dir so it never touches
// the real local database. Must be set before any path is resolved.
if (process.env.SCRIBE_USER_DATA) {
  app.setPath('userData', process.env.SCRIBE_USER_DATA);
}

// Strict production CSP (CLAUDE.md §1.3, PRODUCT_SPEC.md §7). 'unsafe-inline' is
// kept only for styles (React/Tailwind inject inline styles); scripts are locked
// to 'self'. In dev the Vite HMR client needs inline/eval, so the dev CSP comes
// from the permissive meta tag in index.html and we skip the header below.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  // The AudioWorklet module (/pcm-framer.worklet.js) loads as a worker-context script.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
].join('; ');

function hardenSession(): void {
  if (isDev) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PROD_CSP],
      },
    });
  });
}

// The Nexus window icon: from build/ in dev, from the bundled extraResource when packaged
// (the .exe icon stays default since signAndEditExecutable is off — ROADMAP_V04_09).
const windowIcon = isDev
  ? join(__dirname, '../../build/icon.png')
  : join(process.resourcesPath, 'icon.png');

function createWindow(): void {
  const win = new BrowserWindow({
    // Restored size/position, clamped to a visible display (ROADMAP_V04_06).
    ...initialWindowBounds(),
    ...MIN_SIZE,
    icon: windowIcon,
    show: false,
    // Theme-driven so the native frame never flashes the wrong colour (ROADMAP_V04_01).
    backgroundColor: initialBackgroundColor(),
    // Frameless with OS-drawn window controls; the custom TitleBar fills the strip
    // (ROADMAP_V04_03). Overlay colours follow the theme via registerThemeWindow.
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayConfig(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Keep the native background in step with the effective theme (ROADMAP_V04_01).
  registerThemeWindow(win);
  // Restore maximized state + persist size/position across launches (ROADMAP_V04_06).
  registerWindowState(win);

  // Renderer is untrusted: deny popups and block all in-app navigation (§1.3, §7).
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

app
  .whenReady()
  .then(() => {
    hardenSession();
    setupAudioCapture(session.defaultSession);
    initDb();
    // Before the window loads, so prefers-color-scheme is correct on first paint.
    initTheme();
    // Drop Electron's generic File/Edit/View menu; the app uses a custom title bar
    // (ROADMAP_V04_03). Chromium still handles clipboard/undo in editable content.
    Menu.setApplicationMenu(null);
    registerIpcHandlers();
    createWindow();
    // Start the in-app auto-updater (V07). No-op in dev; in packaged builds it
    // schedules a check 60 s after boot and every 6 h after.
    initUpdater();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((err: unknown) => {
    logger.error('startup failed', err instanceof Error ? err : String(err));
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  void disposeTranscription();
  stopCalendarSync();
  disposeUpdater();
  closeDb();
});
