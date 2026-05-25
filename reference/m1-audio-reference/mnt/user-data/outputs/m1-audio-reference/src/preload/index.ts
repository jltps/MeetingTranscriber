import { contextBridge } from 'electron';

/**
 * M1 needs no privileged IPC — mic + loopback capture are Web APIs available
 * in the renderer. We still expose a single typed `window.api` to establish the
 * boundary the rest of the app will use.
 *
 * M2 adds: pushAudioFrame(pcm: ArrayBuffer) -> forwards interleaved PCM to the
 * MAIN process, which owns the Deepgram WebSocket so the API key never reaches
 * the renderer (PRODUCT_SPEC.md §6.3, CLAUDE.md §1).
 */
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
});
