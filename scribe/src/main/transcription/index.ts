import { DeepgramSession } from './deepgram';
import { getDeepgramKey } from '../secrets/api-keys';
import { getLanguage } from '../db/settings';
import type { TranscriptionSession } from './session';
import type { TranscriptSegment } from '../../shared/types';
import type { TranscriptionStatus } from '../../shared/ipc-contract';

export type TranscriptionSessionConfig = {
  onSegment: (seg: TranscriptSegment) => void;
  onStatus: (status: TranscriptionStatus) => void;
  /** Called once when Deepgram returns the first detected language (auto mode). */
  onLanguageDetected?: (bcp47: string) => void;
};

// Callers depend only on this factory + the TranscriptionSession interface, never
// on a concrete provider (CLAUDE.md §5). v2 branches here to add local Whisper.
export function createTranscriptionSession(
  config: TranscriptionSessionConfig,
): TranscriptionSession {
  const session = new DeepgramSession({
    apiKey: getDeepgramKey() ?? '',
    languageSetting: getLanguage(),
    onLanguageDetected: config.onLanguageDetected,
    onOpen: () => config.onStatus({ state: 'open' }),
    onClose: () => config.onStatus({ state: 'closed' }),
    onError: (error) => config.onStatus({ state: 'error', message: error.message }),
  });
  session.onPartial(config.onSegment);
  session.onFinal(config.onSegment);
  return session;
}
