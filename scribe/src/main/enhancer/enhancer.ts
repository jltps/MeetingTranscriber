import type { EnhancedNotes } from '../../shared/types';

// A transcript segment carrying its DB id, so the LLM can cite sourceSegmentIds
// (PRODUCT_SPEC.md §9). This refines the §9 sketch, which used a plain
// TranscriptSegment — ids are required for source linking (built out in M5).
export type EnhancerSegment = {
  id: number;
  channel: 0 | 1;
  speakerLabel: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type EnhanceInput = {
  userNotes: string;
  transcript: EnhancerSegment[];
  /** BCP-47 language code. When present, the LLM is instructed to respond in this language. */
  detectedLanguage?: string;
  /** Free-text instructions from the user (global setting or template). */
  globalInstructions?: string;
};

// The enhancement provider interface (PRODUCT_SPEC.md §9). UI/IPC code depends on
// the factory in ./index, never on a concrete provider (CLAUDE.md §8).
export interface Enhancer {
  enhance(input: EnhanceInput): Promise<EnhancedNotes>;
}
