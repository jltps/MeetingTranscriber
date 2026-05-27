import { registerAppIpc } from './app';
import { registerCalendarIpc } from './calendar';
import { registerChatIpc } from './chat';
import { registerEnhancerIpc } from './enhancer';
import { registerExportIpc } from './export';
import { registerMeetingsIpc } from './meetings';
import { registerOrganizationIpc } from './organization';
import { registerSettingsIpc } from './settings';
import { registerSpeakersIpc } from './speakers';
import { registerTemplatesIpc } from './templates';
import { registerThemeIpc } from './theme';
import { registerTranscriptionIpc } from './transcription';
import { registerWhisperIpc } from './whisper';

// One registration entry point; each IPC domain gets its own file (CLAUDE.md §3).
export function registerIpcHandlers(): void {
  registerAppIpc();
  registerMeetingsIpc();
  registerOrganizationIpc();
  registerTemplatesIpc();
  registerTranscriptionIpc();
  registerEnhancerIpc();
  registerSpeakersIpc();
  registerExportIpc();
  registerSettingsIpc();
  registerThemeIpc();
  registerWhisperIpc();
  registerCalendarIpc();
  registerChatIpc();
}
