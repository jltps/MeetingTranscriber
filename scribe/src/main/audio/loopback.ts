import { BrowserWindow, desktopCapturer } from 'electron';
import type { DesktopCapturerSource, Session } from 'electron';
import { IPC } from '../../shared/ipc-contract';
import { logger } from '../logger';

// The privileged half of M1 (CLAUDE.md §1.3, §6; PRODUCT_SPEC.md §6.1). Two grants:
//
// 1. getDisplayMedia -> system (loopback) audio. Chromium normally requires a
//    video source alongside the loopback audio so it can show a picker; the
//    renderer immediately discards the video track and keeps only the
//    'loopback' audio (the WASAPI system mix on Windows). V073 block 01.2:
//    on hosts where `desktopCapturer` returns no screens (RDP / session-isolated
//    VMs / HDMI-only setups we've seen on a few user machines) we fall back to
//    window sources, and ultimately to an audio-only grant (Electron 33 accepts
//    `{ audio: 'loopback' }` with no video). When even that fails we notify the
//    renderer over `audio:loopback-denied` so the UI can guide the user.
// 2. The 'media' permission so the renderer's mic getUserMedia works. (The
//    Windows OS-level mic privacy setting must still allow desktop apps.)
export function setupAudioCapture(session: Session): void {
  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void resolveLoopbackResponse()
        .then((response) => {
          if (response === null) {
            notifyLoopbackDenied(
              'Windows did not expose any screen/window source for loopback. Run the app in your own desktop session (not over RDP) and ensure an output device is set as default.',
            );
            callback({});
            return;
          }
          callback(response);
        })
        .catch((err: unknown) => {
          logger.warn(
            'display-media: enumeration failed; denying',
            err instanceof Error ? err : String(err),
          );
          notifyLoopbackDenied(
            'Could not enumerate sources for loopback capture. Check Windows audio permissions and try again.',
          );
          callback({});
        });
    },
    // Our handler, not the OS picker, so capture starts silently.
    { useSystemPicker: false },
  );

  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
}

/**
 * Build the response that satisfies Chromium's getDisplayMedia for the loopback
 * grant. Returns `null` when we can't grant in any form.
 *
 * Step 1: a screen source. The common case.
 * Step 2: any window source. RDP/some VM setups expose no screens but still
 *         expose application windows; Chromium accepts either as the "video"
 *         half and we ignore the actual video stream renderer-side.
 * Step 3: audio-only (no video). Electron 33 accepts this for `loopback` and
 *         it's the fallback when even `getSources` returns nothing.
 */
async function resolveLoopbackResponse(): Promise<
  | { video: DesktopCapturerSource; audio: 'loopback' }
  | { audio: 'loopback' }
  | null
> {
  // Step 1 — screens.
  try {
    const screens = await desktopCapturer.getSources({ types: ['screen'] });
    if (screens.length > 0) {
      logger.info('display-media: granting loopback', `screenSources=${screens.length}`);
      return { video: screens[0], audio: 'loopback' };
    }
  } catch (err) {
    logger.warn('display-media: screen enumeration threw', String(err));
  }
  // Step 2 — windows.
  try {
    const windows = await desktopCapturer.getSources({ types: ['window'] });
    if (windows.length > 0) {
      logger.info(
        'display-media: no screens; granting loopback via window source',
        `windowSources=${windows.length}`,
      );
      return { video: windows[0], audio: 'loopback' };
    }
  } catch (err) {
    logger.warn('display-media: window enumeration threw', String(err));
  }
  // Step 3 — audio-only loopback.
  logger.info('display-media: no video sources; granting audio-only loopback');
  return { audio: 'loopback' };
}

/** Push a one-line warning to every renderer so the UI can react. */
function notifyLoopbackDenied(reason: string): void {
  logger.warn('display-media: loopback denied', reason);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.audioLoopbackDenied, { reason });
    }
  }
}
