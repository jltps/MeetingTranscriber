/**
 * Cross-meeting querying (ROADMAP_07 Phase 2) — the pure pieces (CLAUDE.md §9):
 * the lexical scorer/ranker, the IPC Zod schemas, and citation-id → meeting
 * mapping. No Electron/network/DB.
 */
import { describe, it, expect } from 'vitest';
import { CrossChatAskSchema, RetrievalScopeSchema } from '../src/shared/ipc-contract';
import { rankSegments, scoreSegment, tokenize } from '../src/main/chat/retrieval/scorer';
import { validateCitations } from '../src/main/chat/citations';

describe('tokenize', () => {
  it('lowercases, strips punctuation, drops 1-char noise', () => {
    expect(tokenize('What about Q3 pricing?!')).toEqual(['what', 'about', 'q3', 'pricing']);
  });

  it('returns nothing for a term-less query', () => {
    expect(tokenize('  ?  a  ')).toEqual([]);
  });
});

describe('scoreSegment', () => {
  it('counts distinct query terms present (coverage, not frequency)', () => {
    expect(scoreSegment(['pricing', 'q3'], 'pricing pricing pricing')).toBe(1);
    expect(scoreSegment(['pricing', 'q3'], 'Q3 pricing was discussed')).toBe(2);
  });

  it('is zero when no term matches or no terms given', () => {
    expect(scoreSegment(['pricing'], 'unrelated text')).toBe(0);
    expect(scoreSegment([], 'pricing')).toBe(0);
  });
});

describe('rankSegments', () => {
  const segs = [
    { id: 1, text: 'we set the pricing for Q3' },
    { id: 2, text: 'lunch plans for friday' },
    { id: 3, text: 'pricing discussion continued' },
  ];

  it('orders by term coverage and applies the limit', () => {
    const ranked = rankSegments(segs, 'Q3 pricing', 2);
    expect(ranked.map((s) => s.id)).toEqual([1, 3]); // id 1 covers both terms, id 3 one
  });

  it('drops non-matching segments', () => {
    expect(rankSegments(segs, 'pricing', 10).map((s) => s.id)).toEqual([1, 3]);
  });

  it('returns nothing when the query matches nothing', () => {
    expect(rankSegments(segs, 'kubernetes', 10)).toEqual([]);
  });

  it('keeps input order (truncated to limit) for a term-less query', () => {
    expect(rankSegments(segs, '   ', 2).map((s) => s.id)).toEqual([1, 2]);
  });
});

describe('RetrievalScopeSchema', () => {
  it('accepts the all-meetings scope', () => {
    expect(RetrievalScopeSchema.safeParse({ mode: 'all' }).success).toBe(true);
  });

  it('accepts an explicit meeting set', () => {
    expect(RetrievalScopeSchema.safeParse({ mode: 'meetings', meetingIds: [1, 2] }).success).toBe(
      true,
    );
  });

  it('rejects an empty explicit meeting set', () => {
    expect(RetrievalScopeSchema.safeParse({ mode: 'meetings', meetingIds: [] }).success).toBe(false);
  });

  it('rejects an unknown mode', () => {
    expect(RetrievalScopeSchema.safeParse({ mode: 'folder' }).success).toBe(false);
  });
});

describe('CrossChatAskSchema', () => {
  it('accepts a valid cross-meeting ask', () => {
    const parsed = CrossChatAskSchema.safeParse({
      scope: { mode: 'all' },
      messages: [{ role: 'user', content: 'what did we decide about pricing?' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty message list', () => {
    expect(
      CrossChatAskSchema.safeParse({ scope: { mode: 'all' }, messages: [] }).success,
    ).toBe(false);
  });
});

describe('cross-meeting citation mapping', () => {
  // Mirrors runCrossChat: validate cited ids against the retrieved set, then map
  // each surviving id back to its source meeting.
  const retrieved = [
    { id: 10, meetingId: 1, meetingTitle: 'Kickoff' },
    { id: 22, meetingId: 4, meetingTitle: 'Pricing review' },
  ];

  it('maps validated ids to their meeting and drops hallucinated ids', () => {
    const text = 'We aligned on scope [id=10] and deferred pricing [id=22][id=999].';
    const byId = new Map(retrieved.map((s) => [s.id, s]));
    const citations = validateCitations(
      text,
      retrieved.map((s) => s.id),
    ).map((segmentId) => {
      const seg = byId.get(segmentId)!;
      return { segmentId, meetingId: seg.meetingId, meetingTitle: seg.meetingTitle };
    });
    expect(citations).toEqual([
      { segmentId: 10, meetingId: 1, meetingTitle: 'Kickoff' },
      { segmentId: 22, meetingId: 4, meetingTitle: 'Pricing review' },
    ]);
  });
});
