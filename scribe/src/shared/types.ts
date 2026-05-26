// Domain types shared across main, preload, and renderer.
// This module must import nothing from electron, node:*, or React (CLAUDE.md §3).

/**
 * Language setting for transcription + enhancement output (FEATURES §A).
 * 'auto' — use nova-3 multilingual mode; detect from transcript at LLM layer.
 * 'fixed' — pass the BCP-47 code directly to Deepgram and the enhancer.
 */
export type LanguageSetting =
  | { mode: 'auto' }
  | { mode: 'fixed'; bcp47: string };

/** A single transcribed span. channel 0 = microphone ("Me"), 1 = system audio. */
export type TranscriptSegment = {
  text: string;
  channel: 0 | 1;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
};

/** A persisted transcript segment (carries its DB id, for source linking §8.4). */
export type PersistedSegment = TranscriptSegment & { id: number };

/** Structured, source-linked enhancement returned by the LLM (PRODUCT_SPEC.md §9). */
export type EnhancedNotes = {
  blocks: Array<{
    type: 'heading' | 'paragraph' | 'bullet' | 'action_item';
    text: string;
    origin: 'user' | 'ai';
    sourceSegmentIds: number[];
  }>;
};

export type MeetingStatus = 'draft' | 'transcribing' | 'ended';

/** Row-level meeting metadata for the sidebar list (PRODUCT_SPEC.md §11). */
export type MeetingSummary = {
  id: number;
  title: string;
  status: MeetingStatus;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
};

/** A meeting plus its notes, for the open editor. */
export type MeetingDetail = MeetingSummary & {
  rawUserMd: string;
  enhancedJson: string | null;
};
