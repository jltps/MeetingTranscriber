import type { TranscriptSegment } from '../../shared/types';
import type { DeepgramWordView } from './parse';
import type { ProviderInsights } from './parse-gladia';

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
  /**
   * V08 — fires once after the session ends with the normalized post-call
   * intelligence (diarization + NER + sentiment). Optional: only the Gladia
   * session implements it. The IPC layer reconciles "Me"/speaker labels against
   * the persisted transcript and stores the result. Because it fires *after*
   * stop(), the owning session must stay alive until then (the IPC layer keeps a
   * reference); see `abort()` for the app-quit teardown path.
   */
  onInsights?(cb: (insights: ProviderInsights) => void): void;
  /** V08 — provider session id(s) (multiple across a handoff), for persisting
   * with the insights row + boot-resume. Optional: only Gladia has them. */
  sessionIds?(): string[];
  stop(): Promise<void>;
  /**
   * V08 — hard teardown without emitting `onInsights`, for app quit. Optional:
   * only sessions with post-stop work (Gladia) need it; others are fully torn
   * down by stop().
   */
  abort?(): void;
}
