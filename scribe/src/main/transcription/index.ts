import { DeepgramSession } from './deepgram';
import { WhisperSession } from './whisper';
import { GladiaSession } from './gladia';
import { getDeepgramKey, getGladiaKey } from '../secrets/api-keys';
import {
  getLanguage,
  getTranscriptIncludeFillers,
  getTranscriptionProvider,
  getWhisperModel,
} from '../db/settings';
import type { TranscriptionSession } from './session';
import type { DeepgramWordView } from './parse';
import type { ProviderInsights } from './parse-gladia';
import type { TranscriptSegment } from '../../shared/types';
import type { TranscriptionStatus } from '../../shared/ipc-contract';

export type TranscriptionSessionConfig = {
  onSegment: (seg: TranscriptSegment) => void;
  onStatus: (status: TranscriptionStatus) => void;
  /** Called once when the provider identifies the transcript language (auto mode). */
  onLanguageDetected?: (bcp47: string) => void;
  /**
   * V062 ROADMAP_01: fires on finalized results in single-channel mode with the
   * raw per-word data. When the underlying provider supports it (Deepgram), the
   * provider will suppress `onSegment` for those finals so the IPC layer can do
   * per-word "Me" attribution + regrouping itself.
   */
  onWords?: (words: DeepgramWordView[]) => void;
  /**
   * V08: fires once after a Gladia session ends with the normalized post-call
   * intelligence. Only wired when the active provider supports it (Gladia).
   */
  onInsights?: (insights: ProviderInsights) => void;
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

  if (provider === 'gladia') {
    // V08: Gladia emits utterance-level finals (no per-word `onWords` path) +
    // post-call insights via `onInsights`. "Me" is recovered by the same
    // single-channel energy heuristic the IPC layer applies to `onSegment`.
    const session = new GladiaSession({
      apiKey: getGladiaKey() ?? '',
      languageSetting: getLanguage(),
      onLanguageDetected: config.onLanguageDetected,
      onStatus: config.onStatus,
    });
    session.onPartial(config.onSegment);
    session.onFinal(config.onSegment);
    if (config.onInsights) session.onInsights(config.onInsights);
    return session;
  }

  // Default: Deepgram (existing path, unchanged besides V075 ROADMAP_03's
  // includeFillers gate — snapshotted on session start so mid-meeting toggles
  // require Stop/Start, matching the V073 captureMode pattern).
  const session = new DeepgramSession({
    apiKey: getDeepgramKey() ?? '',
    languageSetting: getLanguage(),
    includeFillers: getTranscriptIncludeFillers(),
    onLanguageDetected: config.onLanguageDetected,
    onStatus: config.onStatus,
  });
  session.onPartial(config.onSegment);
  session.onFinal(config.onSegment);
  if (config.onWords) session.onWords(config.onWords);
  return session;
}
