import { ipcMain } from 'electron';
import { IPC, MeetingIdSchema } from '../../shared/ipc-contract';
import { getEnhancerSegments, getMeeting, saveEnhancedNotes } from '../db/meetings';
import { getTemplate } from '../db/templates';
import { getGlobalInstructions, getLanguage } from '../db/settings';
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

    const template = meeting.templateId !== null ? getTemplate(meeting.templateId) : null;
    const globalLang = getLanguage();
    const detected = getDetectedLanguage();

    // Language resolution order (FEATURES §A3):
    // 1. Template fixed language
    // 2. Template auto → use detected language
    // 3. Global setting fixed language
    // 4. Global setting auto → use detected language
    // 5. Undefined (no language directive)
    let outputLanguage: string | undefined;
    if (template?.languageMode === 'fixed') {
      outputLanguage = template.languageCode ?? undefined;
    } else if (template?.languageMode === 'auto') {
      outputLanguage = detected ?? undefined;
    } else if (globalLang.mode === 'fixed') {
      outputLanguage = globalLang.bcp47;
    } else if (globalLang.mode === 'auto') {
      outputLanguage = detected ?? undefined;
    }

    // Template instructions replace the ROLE_SECTION entirely when non-empty.
    // Global instructions are always an advisory addendum after the role.
    // Both are passed separately so buildSystemPrompt can position them correctly.
    const result = await runEnhancement({
      userNotes: meeting.rawUserMd,
      transcript: getEnhancerSegments(id),
      detectedLanguage: outputLanguage,
      templateInstructions: template?.instructions.trim() || undefined,
      globalInstructions: getGlobalInstructions() || undefined,
    });
    saveEnhancedNotes(id, JSON.stringify(result.notes), outputLanguage ?? null);
    logger.info(
      'enhancement complete',
      `meeting=${id}`,
      `degraded=${result.degraded}`,
      outputLanguage ? `lang=${outputLanguage}` : '',
      template ? `template=${template.name}` : '',
    );
    return result;
  });
}
