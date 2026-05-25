import { desktopCapturer } from 'electron';
import type { Session } from 'electron';
import { logger } from '../logger';

// The privileged half of M1 (CLAUDE.md §1.3, §6; PRODUCT_SPEC.md §6.1). Two grants:
//
// 1. getDisplayMedia -> system (loopback) audio with no picker. Chromium requires
//    a video source to be offered, so we hand it a screen source; the renderer
//    immediately discards the video track and keeps only the 'loopback' audio
//    (the WASAPI system mix on Windows).
// 2. The 'media' permission so the renderer's mic getUserMedia works. (The Windows
//    OS-level mic privacy setting must still allow desktop apps.)
export function setupAudioCapture(session: Session): void {
  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          logger.info('display-media: granting loopback audio', `screenSources=${sources.length}`);
          callback({ video: sources[0], audio: 'loopback' });
        })
        .catch((err: unknown) => {
          logger.warn(
            'display-media: failed to get screen source; denying',
            err instanceof Error ? err : String(err),
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
