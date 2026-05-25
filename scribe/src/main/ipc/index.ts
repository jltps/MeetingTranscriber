import { registerAppIpc } from './app';
import { registerMeetingsIpc } from './meetings';
import { registerTranscriptionIpc } from './transcription';

// One registration entry point; each IPC domain gets its own file (CLAUDE.md §3).
export function registerIpcHandlers(): void {
  registerAppIpc();
  registerMeetingsIpc();
  registerTranscriptionIpc();
}
