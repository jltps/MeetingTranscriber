// The provider-neutral chat seam (V06 block 05). Per-meeting and cross-meeting chat
// depend on this interface; AnthropicChat and the OpenAI-compatible chat both implement
// it, so chat/index.ts never imports a concrete provider.
import type { ChatMessage, EnhancedNotes } from '../../shared/types';
import type { EnhancerSegment } from '../enhancer/enhancer';

export type ChatUsage = { inputTokens: number; outputTokens: number };

export type ChatAnswer = {
  text: string;
  usage: ChatUsage;
  /** True when the transcript had to be summarized (segment ids lost → citations degrade). */
  contextSummarized: boolean;
};

export type ChatRunInput = {
  userNotes: string;
  enhancedNotes: EnhancedNotes | null;
  transcript: EnhancerSegment[];
  /** rawLabel → displayName (ROADMAP_02), so the model sees real names. */
  speakerNames?: Record<string, string>;
  /** Full ephemeral conversation; the last entry is the new user turn. */
  messages: ChatMessage[];
  /** Called with each streamed text delta. */
  onToken: (token: string) => void;
};

/** Options for the generic streaming core (used directly by cross-meeting chat). */
export type StreamAnswerOpts = {
  systemPrompt: string;
  context: string;
  messages: ChatMessage[];
  onToken: (token: string) => void;
};

/** A chat backend. `answer` builds per-meeting context; `streamAnswer` is the raw core. */
export interface ChatEngine {
  answer(input: ChatRunInput): Promise<ChatAnswer>;
  streamAnswer(opts: StreamAnswerOpts): Promise<{ text: string; usage: ChatUsage }>;
}
