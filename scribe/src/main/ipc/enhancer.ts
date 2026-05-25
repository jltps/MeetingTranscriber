import { ipcMain } from 'electron';
import { IPC, MeetingIdSchema } from '../../shared/ipc-contract';
import { getEnhancerSegments, getMeeting, saveEnhancedNotes } from '../db/meetings';
import { runEnhancement } from '../enhancer';
import { logger } from '../logger';

// Enhancement runs in the main process so the Anthropic key never reaches the
// renderer (CLAUDE.md §1.2). The result is persisted to enhanced_json and also
// returned so the renderer can render it immediately.
export function registerEnhancerIpc(): void {
  ipcMain.handle(IPC.enhancerEnhance, async (_event, raw) => {
    const id = MeetingIdSchema.parse(raw);
    const meeting = getMeeting(id);
    if (!meeting) throw new Error(`Meeting ${id} not found`);

    const result = await runEnhancement({
      userNotes: meeting.rawUserMd,
      transcript: getEnhancerSegments(id),
    });
    saveEnhancedNotes(id, JSON.stringify(result.notes));
    logger.info('enhancement complete', `meeting=${id}`, `degraded=${result.degraded}`);
    return result;
  });
}
