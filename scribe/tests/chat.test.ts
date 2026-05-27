/**
 * Per-meeting chat (ROADMAP_07 Phase 1) — pure pieces that break silently
 * (CLAUDE.md §9): the IPC Zod schemas, citation-id validation against real
 * segments, and the renderer [id=N] chip parser. No Electron/network.
 */
import { describe, it, expect } from 'vitest';
import { ChatAskSchema, ChatTokenSchema } from '../src/shared/ipc-contract';
import { extractCitedIds, validateCitations } from '../src/main/chat/citations';
import { parseCitations } from '../src/renderer/features/chat/parse-citations';

describe('ChatAskSchema', () => {
  it('accepts a valid ask with one user turn', () => {
    const parsed = ChatAskSchema.safeParse({
      meetingId: 3,
      messages: [{ role: 'user', content: 'What did we decide?' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a multi-turn conversation', () => {
    const parsed = ChatAskSchema.safeParse({
      meetingId: 1,
      messages: [
        { role: 'user', content: 'Summarize the meeting' },
        { role: 'assistant', content: 'We agreed to ship Friday [id=4].' },
        { role: 'user', content: 'Who owns it?' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty message list', () => {
    expect(ChatAskSchema.safeParse({ meetingId: 1, messages: [] }).success).toBe(false);
  });

  it('rejects empty message content', () => {
    expect(
      ChatAskSchema.safeParse({ meetingId: 1, messages: [{ role: 'user', content: '' }] }).success,
    ).toBe(false);
  });

  it('rejects a non-positive meeting id', () => {
    expect(
      ChatAskSchema.safeParse({ meetingId: 0, messages: [{ role: 'user', content: 'hi' }] }).success,
    ).toBe(false);
  });

  it('rejects an unknown role', () => {
    expect(
      ChatAskSchema.safeParse({ meetingId: 1, messages: [{ role: 'system', content: 'hi' }] })
        .success,
    ).toBe(false);
  });
});

describe('ChatTokenSchema', () => {
  it('accepts a streamed token payload', () => {
    expect(ChatTokenSchema.safeParse({ requestId: 'abc', token: 'hello' }).success).toBe(true);
  });

  it('accepts an empty token (e.g. a stream artifact)', () => {
    expect(ChatTokenSchema.safeParse({ requestId: 'abc', token: '' }).success).toBe(true);
  });

  it('rejects a missing requestId', () => {
    expect(ChatTokenSchema.safeParse({ token: 'hello' }).success).toBe(false);
  });
});

describe('extractCitedIds', () => {
  it('pulls all [id=N] markers in order, including repeats', () => {
    expect(extractCitedIds('A [id=5] B [id=12] C [id=5].')).toEqual([5, 12, 5]);
  });

  it('returns nothing when there are no markers', () => {
    expect(extractCitedIds('no citations here')).toEqual([]);
  });
});

describe('validateCitations', () => {
  it('keeps only real segment ids, de-duplicated and order-preserving', () => {
    const text = 'Shipped Friday [id=4][id=99]. Owner is Ana [id=4][id=7].';
    expect(validateCitations(text, [4, 7, 12])).toEqual([4, 7]);
  });

  it('drops every id when none match (hallucinated)', () => {
    expect(validateCitations('Maybe [id=999].', [1, 2, 3])).toEqual([]);
  });

  it('returns nothing for an uncited answer', () => {
    expect(validateCitations('I cannot find that in the transcript.', [1, 2])).toEqual([]);
  });
});

describe('parseCitations', () => {
  it('splits text and citation markers into ordered nodes', () => {
    expect(parseCitations('Decided Friday [id=4] done.')).toEqual([
      { kind: 'text', text: 'Decided Friday ' },
      { kind: 'cite', segmentId: 4 },
      { kind: 'text', text: ' done.' },
    ]);
  });

  it('handles adjacent markers with no text between', () => {
    expect(parseCitations('[id=1][id=2]')).toEqual([
      { kind: 'cite', segmentId: 1 },
      { kind: 'cite', segmentId: 2 },
    ]);
  });

  it('returns a single text node when there are no markers', () => {
    expect(parseCitations('plain answer')).toEqual([{ kind: 'text', text: 'plain answer' }]);
  });
});
