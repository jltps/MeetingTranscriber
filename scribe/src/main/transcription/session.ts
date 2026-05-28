import type { TranscriptSegment } from '../../shared/types';
import type { DeepgramWordView } from './parse';

// Provider-agnostic streaming transcription (PRODUCT_SPEC.md §6.2). v1 ships only
// Deepgram behind this interface; v2 can drop in local Whisper without touching
// the IPC layer or the renderer. Implemented in the main process so the API key
// never reaches the renderer (CLAUDE.md §1.2, §6.3).
export interface TranscriptionSession {
  start(opts: { sampleRate: number; channels: number }): Promise<void>;
  pushAudio(pcm: Int16Array): void;
  onPartial(cb: (seg: TranscriptSegment) => void): void;
  onFinal(cb: (seg: TranscriptSegment) => void): void;
  /**
   * Fires on finalized results in single-channel mode with the raw per-word
   * data, so callers (the IPC layer) can run the V062 per-word "Me"
   * attribution + regrouping against their owned `energyTimeline`. Optional:
   * only the Deepgram session implements it; the Whisper path has no word-
   * level diarization. When present, the session is responsible for *not*
   * also firing `onFinal` with the same content, to avoid double-emit.
   */
  onWords?(cb: (words: DeepgramWordView[]) => void): void;
  stop(): Promise<void>;
}
