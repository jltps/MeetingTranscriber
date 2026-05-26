import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import {
  IPC,
  TranscriptSegmentSchema,
  TranscriptionLanguageSchema,
  TranscriptionStatusSchema,
} from '../shared/ipc-contract';
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
  onTranscriptionLanguage: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      cb(TranscriptionLanguageSchema.parse(payload));
    };
    ipcRenderer.on(IPC.transcriptionLanguageDetected, listener);
    return () => ipcRenderer.removeListener(IPC.transcriptionLanguageDetected, listener);
  },
  meetings: {
    list: () => ipcRenderer.invoke(IPC.meetingsList),
    create: () => ipcRenderer.invoke(IPC.meetingsCreate),
    get: (id) => ipcRenderer.invoke(IPC.meetingsGet, id),
    getTranscript: (id) => ipcRenderer.invoke(IPC.meetingsGetTranscript, id),
    saveNotes: (id, markdown) => ipcRenderer.invoke(IPC.meetingsSaveNotes, { id, markdown }),
    updateTitle: (id, title) => ipcRenderer.invoke(IPC.meetingsUpdateTitle, { id, title }),
    start: (id) => ipcRenderer.invoke(IPC.meetingsStart, id),
    end: (id) => ipcRenderer.invoke(IPC.meetingsEnd, id),
    remove: (id) => ipcRenderer.invoke(IPC.meetingsDelete, id),
    search: (query) => ipcRenderer.invoke(IPC.meetingsSearch, query),
    saveEnhanced: (id, notes) => ipcRenderer.invoke(IPC.meetingsSaveEnhanced, { id, notes }),
    setTemplate: (meetingId, templateId) =>
      ipcRenderer.invoke(IPC.meetingsSetTemplate, { meetingId, templateId }),
  },
  templates: {
    list: () => ipcRenderer.invoke(IPC.templatesList),
    get: (id) => ipcRenderer.invoke(IPC.templatesGet, id),
    create: (data) => ipcRenderer.invoke(IPC.templatesCreate, data),
    update: (id, data) => ipcRenderer.invoke(IPC.templatesUpdate, { id, ...data }),
    remove: (id) => ipcRenderer.invoke(IPC.templatesDelete, id),
    duplicate: (id) => ipcRenderer.invoke(IPC.templatesDuplicate, id),
  },
  enhance: (meetingId) => ipcRenderer.invoke(IPC.enhancerEnhance, meetingId),
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    setKeys: (keys) => ipcRenderer.invoke(IPC.settingsSetKeys, keys),
    setMicDevice: (deviceId) => ipcRenderer.invoke(IPC.settingsSetMicDevice, deviceId),
    setLanguage: (language) => ipcRenderer.invoke(IPC.settingsSetLanguage, language),
    setGlobalInstructions: (instructions) =>
      ipcRenderer.invoke(IPC.settingsSetGlobalInstructions, instructions),
    test: (provider, key) => ipcRenderer.invoke(IPC.settingsTest, { provider, key }),
    acceptPrivacy: () => ipcRenderer.invoke(IPC.settingsAcceptPrivacy),
    wipe: () => ipcRenderer.invoke(IPC.settingsWipe),
  },
};

contextBridge.exposeInMainWorld('api', api);
