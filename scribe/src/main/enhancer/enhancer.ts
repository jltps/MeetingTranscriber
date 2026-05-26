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
  /**
   * Template instructions — replace the fixed ROLE_SECTION entirely when non-empty.
   * What the user sees and edits in TemplateEditorModal is exactly this text.
   */
  templateInstructions?: string;
  /** Global instructions from Settings — appended as an advisory addendum. */
  globalInstructions?: string;
  /**
   * Speaker name mapping (ROADMAP_02) — rawLabel → displayName.
   * When present, the transcript sent to the LLM uses real names instead of
   * auto-generated labels ("Ana: …" rather than "Speaker 1: …").
   */
  speakerNames?: Record<string, string>;
};

/** Token consumption for a single enhancement call (ROADMAP_01 §3). */
export type EnhancerUsage = {
  inputTokens: number;
  outputTokens: number;
};

/** Result of a successful enhancement, including token usage for cost tracking. */
export type EnhanceResult = {
  notes: EnhancedNotes;
  usage: EnhancerUsage;
};

// The enhancement provider interface (PRODUCT_SPEC.md §9). UI/IPC code depends on
// the factory in ./index, never on a concrete provider (CLAUDE.md §8).
export interface Enhancer {
  enhance(input: EnhanceInput): Promise<EnhanceResult>;
  enhanceFallback(input: EnhanceInput): Promise<EnhanceResult>;
}
