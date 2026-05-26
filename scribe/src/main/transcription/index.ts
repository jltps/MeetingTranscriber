import { DeepgramSession } from './deepgram';
import { WhisperSession } from './whisper';
import { getDeepgramKey } from '../secrets/api-keys';
import { getLanguage, getTranscriptionProvider, getWhisperModel } from '../db/settings';
import type { TranscriptionSession } from './session';
import type { TranscriptSegment } from '../../shared/types';
import type { TranscriptionStatus } from '../../shared/ipc-contract';

export type TranscriptionSessionConfig = {
  onSegment: (seg: TranscriptSegment) => void;
  onStatus: (status: TranscriptionStatus) => void;
  /** Called once when the provider identifies the transcript language (auto mode). */
  onLanguageDetected?: (bcp47: string) => void;
};

// Callers depend only on this factory + the TranscriptionSession interface, never
// on a concrete provider (CLAUDE.md §5). v2: branches on transcription_provider
// setting — 'deepgram' (default) or 'whisper' (local, ROADMAP_05).
export function createTranscriptionSession(
  config: TranscriptionSessionConfig,
): TranscriptionSession {
  const provider = getTranscriptionProvider();

  if (provider === 'whisper') {
    const session = new WhisperSession(
      getWhisperModel(),
      getLanguage(),
      config.onLanguageDetected,
      config.onStatus,
    );
    session.onPartial(config.onSegment);
    session.onFinal(config.onSegment);
    return session;
  }

  // Default: Deepgram (existing path, unchanged).
  const session = new DeepgramSession({
    apiKey: getDeepgramKey() ?? '',
    languageSetting: getLanguage(),
    onLanguageDetected: config.onLanguageDetected,
    onStatus: config.onStatus,
  });
  session.onPartial(config.onSegment);
  session.onFinal(config.onSegment);
  return session;
}
