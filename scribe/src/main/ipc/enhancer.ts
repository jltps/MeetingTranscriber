import { ipcMain } from 'electron';
import { IPC, MeetingIdSchema } from '../../shared/ipc-contract';
import { getEnhancerSegments, getMeeting, saveEnhancedNotes } from '../db/meetings';
import { runEnhancement } from '../enhancer';
import { logger } from '../logger';
import { getDetectedLanguage } from './transcription';

// Enhancement runs in the main process so the Anthropic key never reaches the
// renderer (CLAUDE.md §1.2). The result is persisted to enhanced_json and also
// returned so the renderer can render it immediately.
export function registerEnhancerIpc(): void {
  ipcMain.handle(IPC.enhancerEnhance, async (_event, raw) => {
    const id = MeetingIdSchema.parse(raw);
    const meeting = getMeeting(id);
    if (!meeting) throw new Error(`Meeting ${id} not found`);

    // Use the language detected during this meeting's transcription session (§A3).
    // getDetectedLanguage() returns null if the language was fixed (not auto) or
    // not yet detected; in that case the prompt won't include a language directive.
    const detectedLanguage = getDetectedLanguage() ?? undefined;

    const result = await runEnhancement({
      userNotes: meeting.rawUserMd,
      transcript: getEnhancerSegments(id),
      detectedLanguage,
    });
    saveEnhancedNotes(id, JSON.stringify(result.notes));
    logger.info(
      'enhancement complete',
      `meeting=${id}`,
      `degraded=${result.degraded}`,
      detectedLanguage ? `lang=${detectedLanguage}` : '',
    );
    return result;
  });
}
