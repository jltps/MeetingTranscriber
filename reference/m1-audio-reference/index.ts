import { app, BrowserWindow, session, desktopCapturer } from 'electron';
import { join } from 'path';

/**
 * The crux of M1. Two things happen here:
 *
 * 1. We grant `getDisplayMedia` requests *system (loopback) audio* without
 *    popping a picker. Chromium requires a video source to be offered for
 *    getDisplayMedia, so we hand it a screen source — the renderer then
 *    immediately throws the video track away and keeps only the audio.
 *    (This refines PRODUCT_SPEC.md §6.1, which simplified `video: undefined`;
 *    in practice a video source is required.)
 *
 * 2. We auto-grant the `media` permission so the renderer's mic getUserMedia
 *    works. (The OS-level Windows mic privacy setting must still allow desktop
 *    apps — see README troubleshooting.)
 */
function setupAudioPermissions(): void {
  const s = session.defaultSession;

  s.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          // 'loopback' = capture the system audio mix (WASAPI loopback on Windows).
          callback({ video: sources[0], audio: 'loopback' });
        })
        .catch(() => callback({}));
    },
    // Use our handler rather than the OS picker so capture starts silently.
    { useSystemPicker: false },
  );

  s.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 760,
    height: 600,
    backgroundColor: '#0b0e12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Production (CLAUDE.md §1) prefers sandbox: true. Media + worklet work
      // either way; kept false here only to minimise reference-build friction.
      sandbox: false,
    },
  });

  // electron-vite sets ELECTRON_RENDERER_URL in dev; loads the built file otherwise.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  setupAudioPermissions();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
