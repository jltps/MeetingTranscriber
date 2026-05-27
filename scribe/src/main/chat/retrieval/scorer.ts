// Pure lexical scoring for cross-meeting retrieval (ROADMAP_07 Phase 2). No DB or
// Anthropic imports so it unit-tests in isolation (CLAUDE.md §9). This is the
// cheap FTS-shortlist + in-memory rank approach; the Retriever interface lets a
// segment-level FTS table or embeddings replace it later without touching callers.

/**
 * Split text into lowercased, punctuation-stripped terms. Mirrors the
 * normalization in db/meetings.ts `toFtsMatch`, dropping 1-char noise so common
 * single letters don't match everything.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((t) => t.length >= 2);
}

/** Score a segment by how many distinct query terms it contains (term coverage). */
export function scoreSegment(queryTerms: string[], text: string): number {
  if (queryTerms.length === 0) return 0;
  const hay = text.toLowerCase();
  let score = 0;
  for (const term of new Set(queryTerms)) {
    if (hay.includes(term)) score += 1;
  }
  return score;
}

/**
 * Rank segments by query relevance and keep the top `limit`. An empty/term-less
 * query keeps input order (the caller supplies recent meetings); a query that
 * matches nothing returns [] so the answer stays grounded (it will decline).
 */
export function rankSegments<T extends { text: string }>(
  segments: T[],
  query: string,
  limit: number,
): T[] {
  const terms = tokenize(query);
  if (terms.length === 0) return segments.slice(0, limit);
  return segments
    .map((seg) => ({ seg, score: scoreSegment(terms, seg.text) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.seg);
}
