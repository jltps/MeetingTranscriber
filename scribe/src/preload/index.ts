import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC, TranscriptSegmentSchema, TranscriptionStatusSchema } from '../shared/ipc-contract';
import type { ScribeApi } from '../shared/ipc-contract';

// The only object the renderer ever sees. No raw ipcRenderer, no Node globals,
// no dynamic channel names (CLAUDE.md §4). Inbound events are validated against
// the contract schemas before reaching renderer code.
const api: ScribeApi = {
  getStatus: () => ipcRenderer.invoke(IPC.appGetStatus),
  startTranscription: (opts) => ipcRenderer.invoke(IPC.transcriptionStart, opts),
  stopTranscription: () => ipcRenderer.invoke(IPC.transcriptionStop),
  pushAudioFrame: (pcm) => ipcRenderer.send(IPC.transcriptionPushFrame, pcm),
  onTranscriptSegment: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      cb(TranscriptSegmentSchema.parse(payload));
    };
    ipcRenderer.on(IPC.transcriptionSegment, listener);
    return () => ipcRenderer.removeListener(IPC.transcriptionSegment, listener);
  },
  onTranscriptionStatus: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      cb(TranscriptionStatusSchema.parse(payload));
    };
    ipcRenderer.on(IPC.transcriptionStatus, listener);
    return () => ipcRenderer.removeListener(IPC.transcriptionStatus, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
