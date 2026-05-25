import type { TranscriptSegment } from '../../shared/types';

// Provider-agnostic streaming transcription (PRODUCT_SPEC.md §6.2). v1 ships only
// Deepgram behind this interface; v2 can drop in local Whisper without touching
// the IPC layer or the renderer. Implemented in the main process so the API key
// never reaches the renderer (CLAUDE.md §1.2, §6.3).
export interface TranscriptionSession {
  start(opts: { sampleRate: number; channels: number }): Promise<void>;
  pushAudio(pcm: Int16Array): void;
  onPartial(cb: (seg: TranscriptSegment) => void): void;
  onFinal(cb: (seg: TranscriptSegment) => void): void;
  stop(): Promise<void>;
}
