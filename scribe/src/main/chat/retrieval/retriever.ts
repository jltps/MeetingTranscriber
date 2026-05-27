import type { EnhancerSegment } from '../../enhancer/enhancer';
import type { RetrievalScope } from '../../../shared/types';

// Single source of truth for the scope union lives in shared/types (ROADMAP_V04_04
// added folder/tag modes); re-export so retrieval consumers keep importing it here.
export type { RetrievalScope };

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
