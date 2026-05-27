import { activeChat } from '../llm/provider';
import type { ChatMessage, CrossChatCitation, EnhancedNotes } from '../../shared/types';
import type { EnhancerSegment } from '../enhancer/enhancer';
import type { ChatUsage } from './engine';
import { validateCitations } from './citations';
import { buildCrossMeetingContext, buildCrossMeetingSystemPrompt } from './prompt';
import { FtsRetriever } from './retrieval/fts-retriever';
import type { RetrievalScope } from './retrieval/retriever';

// How many transcript segments (across all scoped meetings) to feed the model.
// Bounds cost; the answer is grounded only in these (ROADMAP_07 — retrieve-then-answer).
const CROSS_SEGMENT_LIMIT = 40;

/** Full result of a chat answer, including token usage for cost tracking (ROADMAP_01 §3). */
export type RunChatResult = {
  text: string;
  citationIds: number[];
  degraded: boolean;
  usage: ChatUsage;
};

export type RunChatInput = {
  userNotes: string;
  enhancedNotes: EnhancedNotes | null;
  transcript: EnhancerSegment[];
  speakerNames?: Record<string, string>;
  messages: ChatMessage[];
  onToken: (token: string) => void;
};

// Orchestrates per-meeting chat behind the Anthropic key, which never reaches the
// renderer (CLAUDE.md §1.2). Cited [id=N] markers are validated against the
// meeting's real segments so the answer only ever links to lines that exist.
// The IPC handler persists usage (mirrors the enhancer's split).
export async function runChat(input: RunChatInput): Promise<RunChatResult> {
  // The factory selects the provider and throws if it isn't configured (§1.2, block 05).
  const chat = activeChat();
  const answer = await chat.answer(input);
  const citationIds = validateCitations(
    answer.text,
    input.transcript.map((s) => s.id),
  );
  return {
    text: answer.text,
    citationIds,
    // A summarized long transcript loses segment ids, so grounded citations
    // degrade — surface that to the UI.
    degraded: answer.contextSummarized,
    usage: answer.usage,
  };
}

// ── Cross-meeting querying (ROADMAP_07 Phase 2) ─────────────────────────────────

export type RunCrossChatResult = {
  text: string;
  citations: CrossChatCitation[];
  degraded: boolean;
  usage: ChatUsage;
};

export type RunCrossChatInput = {
  scope: RetrievalScope;
  messages: ChatMessage[];
  onToken: (token: string) => void;
};

// Retrieves the most relevant segments across the scoped meetings, then streams a
// grounded answer over just those (retrieve-then-answer; cost bounded by the
// retrieval limit). Cited [id=N] markers are validated against the retrieved set —
// segment ids are global, so each maps back to its source meeting for navigation.
export async function runCrossChat(input: RunCrossChatInput): Promise<RunCrossChatResult> {
  // The latest user turn is the retrieval query.
  const query = [...input.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const retrieved = new FtsRetriever().retrieve(query, input.scope, CROSS_SEGMENT_LIMIT);

  const chat = activeChat();
  const { text, usage } = await chat.streamAnswer({
    systemPrompt: buildCrossMeetingSystemPrompt(),
    context: buildCrossMeetingContext(retrieved),
    messages: input.messages,
    onToken: input.onToken,
  });

  // Map each validated citation id back to its source meeting.
  const byId = new Map(retrieved.map((s) => [s.id, s]));
  const citations: CrossChatCitation[] = validateCitations(
    text,
    retrieved.map((s) => s.id),
  ).map((segmentId) => {
    const seg = byId.get(segmentId)!;
    return { segmentId, meetingId: seg.meetingId, meetingTitle: seg.meetingTitle };
  });

  return { text, citations, degraded: retrieved.length === 0, usage };
}
