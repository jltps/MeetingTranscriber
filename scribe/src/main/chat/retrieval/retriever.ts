import type { EnhancerSegment } from '../../enhancer/enhancer';

/** Which meetings a cross-meeting query covers (ROADMAP_07 Phase 2). */
export type RetrievalScope = { mode: 'all' } | { mode: 'meetings'; meetingIds: number[] };

/** A transcript segment tagged with its source meeting, for cross-meeting citations. */
export type RetrievedSegment = EnhancerSegment & {
  meetingId: number;
  meetingTitle: string;
};

/**
 * Retrieves the most relevant transcript segments across a set of meetings. Kept
 * behind this interface so the FTS+lexical implementation can be swapped for a
 * segment-level FTS table or embeddings later without touching the LLM/UI layers.
 */
export interface Retriever {
  retrieve(query: string, scope: RetrievalScope, limit: number): RetrievedSegment[];
}
