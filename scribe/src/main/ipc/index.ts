import { registerAppIpc } from './app';
import { registerEnhancerIpc } from './enhancer';
import { registerExportIpc } from './export';
import { registerMeetingsIpc } from './meetings';
import { registerSettingsIpc } from './settings';
import { registerSpeakersIpc } from './speakers';
import { registerTemplatesIpc } from './templates';
import { registerTranscriptionIpc } from './transcription';

// One registration entry point; each IPC domain gets its own file (CLAUDE.md §3).
export function registerIpcHandlers(): void {
  registerAppIpc();
  registerMeetingsIpc();
  registerTemplatesIpc();
  registerTranscriptionIpc();
  registerEnhancerIpc();
  registerSpeakersIpc();
  registerExportIpc();
  registerSettingsIpc();
}
