import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { setupAudioCapture } from './audio/loopback';
import { initDb, closeDb } from './db';
import { registerIpcHandlers } from './ipc';
import { logger } from './logger';

// electron-vite sets this only in dev (renderer served by the Vite dev server).
const devUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = !!devUrl;

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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    backgroundColor: '#0b0e12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

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
    registerIpcHandlers();
    createWindow();

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
  closeDb();
});
