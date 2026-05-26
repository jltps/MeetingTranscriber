import { ipcMain } from 'electron';
import { z } from 'zod';
import {
  IPC,
  SetGlobalInstructionsSchema,
  SetKeysSchema,
  SetLanguageSchema,
  SetMicDeviceSchema,
  TestRequestSchema,
  WhisperModelNameSchema,
} from '../../shared/ipc-contract';
import type { SettingsView, TestResult } from '../../shared/ipc-contract';
import {
  deleteSetting,
  getGlobalInstructions,
  getLanguage,
  getSetting,
  getTranscriptionProvider,
  getWhisperModel,
  setTranscriptionProvider,
  setWhisperModel,
  setSetting,
  wipeAllData,
} from '../db/settings';
import { getUsageTotals } from '../db/meetings';
import {
  getAnthropicKey,
  getDeepgramKey,
  setAnthropicKey,
  setDeepgramKey,
} from '../secrets/api-keys';
import { isGoogleConnected } from '../secrets/calendar-tokens';
import { testDeepgramKey } from '../transcription/deepgram';
import { testAnthropicKey } from '../enhancer/anthropic';
import { logger } from '../logger';

// Settings IPC (PRODUCT_SPEC.md §10). Keys are written (encrypted) but never read
// back to the renderer — settings:get reports only whether each key is set.
export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settingsGet, (): SettingsView => ({
    deepgramKeySet: getDeepgramKey() !== null,
    anthropicKeySet: getAnthropicKey() !== null,
    micDeviceId: getSetting('mic_device_id'),
    language: getLanguage(),
    globalInstructions: getGlobalInstructions(),
    privacyAccepted: getSetting('privacy_accepted') === '1',
    usageTotals: getUsageTotals(),
    transcriptionProvider: getTranscriptionProvider(),
    whisperModel: getWhisperModel(),
    googleCalendarConnected: isGoogleConnected(),
  }));

  ipcMain.handle(IPC.settingsSetKeys, (_event, raw) => {
    const input = SetKeysSchema.parse(raw);
    if (input.deepgram !== undefined) setDeepgramKey(input.deepgram);
    if (input.anthropic !== undefined) setAnthropicKey(input.anthropic);
  });

  ipcMain.handle(IPC.settingsSetMicDevice, (_event, raw) => {
    const id = SetMicDeviceSchema.parse(raw);
    if (id) setSetting('mic_device_id', id);
    else deleteSetting('mic_device_id');
  });

  ipcMain.handle(IPC.settingsSetLanguage, (_event, raw) => {
    // Store as JSON so getLanguage() can parse the structured object.
    setSetting('language', JSON.stringify(SetLanguageSchema.parse(raw)));
  });

  ipcMain.handle(IPC.settingsSetGlobalInstructions, (_event, raw) => {
    setSetting('global_instructions', SetGlobalInstructionsSchema.parse(raw));
  });

  ipcMain.handle(IPC.settingsSetTranscriptionProvider, (_event, raw) => {
    const provider = z.enum(['deepgram', 'whisper']).parse(raw);
    setTranscriptionProvider(provider);
  });

  ipcMain.handle(IPC.settingsSetWhisperModel, (_event, raw) => {
    const model = WhisperModelNameSchema.parse(raw);
    setWhisperModel(model);
  });

  ipcMain.handle(IPC.settingsAcceptPrivacy, () => {
    setSetting('privacy_accepted', '1');
  });

  ipcMain.handle(IPC.settingsWipe, () => {
    wipeAllData();
    logger.info('all local data wiped');
  });

  ipcMain.handle(IPC.settingsTest, async (_event, raw): Promise<TestResult> => {
    const { provider, key } = TestRequestSchema.parse(raw);
    // Prefer the just-typed key so "Test" validates what's in the input box, not
    // whatever is already stored (or falling back from .env).
    const typed = key?.trim();
    try {
      if (provider === 'deepgram') {
        const effective = typed || getDeepgramKey();
        if (!effective) return { ok: false, message: 'No Deepgram key to test.' };
        await testDeepgramKey(effective);
      } else {
        const effective = typed || getAnthropicKey();
        if (!effective) return { ok: false, message: 'No Anthropic key to test.' };
        await testAnthropicKey(effective);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
}
