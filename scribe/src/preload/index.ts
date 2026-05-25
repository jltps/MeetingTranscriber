import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-contract';
import type { ScribeApi } from '../shared/ipc-contract';

// The only object the renderer ever sees. No raw ipcRenderer, no Node globals,
// no dynamic channel names (CLAUDE.md §4).
const api: ScribeApi = {
  getStatus: () => ipcRenderer.invoke(IPC.appGetStatus),
};

contextBridge.exposeInMainWorld('api', api);
