import { describe, it, expect } from 'vitest';
import { parseDeepgramWords } from '../src/main/transcription/parse';

describe('parseDeepgramWords', () => {
  it('returns empty + isFinal:false for non-Results messages', () => {
    expect(parseDeepgramWords({ type: 'Metadata' })).toEqual({ words: [], isFinal: false });
  });

  it('returns empty for interim results (per-word path is final-only)', () => {
    const out = parseDeepgramWords({
      type: 'Results',
      is_final: false,
      start: 1.0,
      duration: 0.4,
      channel: {
        alternatives: [
          {
            transcript: 'we should',
            words: [{ word: 'we', start: 1.0, end: 1.2, speaker: 0 }],
          },
        ],
      },
    });
    expect(out).toEqual({ words: [], isFinal: false });
  });

  it('returns empty when the final result has no alternatives or empty transcript', () => {
    expect(
      parseDeepgramWords({
        type: 'Results',
        is_final: true,
        channel: { alternatives: [{ transcript: '   ', words: [] }] },
      }),
    ).toEqual({ words: [], isFinal: true });
  });

  it('projects each word to {text, startMs, endMs, deepgramSpeaker, paragraphIndex}', () => {
    const out = parseDeepgramWords({
      type: 'Results',
      is_final: true,
      start: 0.0,
      duration: 1.0,
      channel: {
        alternatives: [
          {
            transcript: 'Hi there friend',
            words: [
              { word: 'hi', punctuated_word: 'Hi', start: 0.1, end: 0.2, speaker: 3 },
              { word: 'there', start: 0.2, end: 0.4, speaker: 3 },
              { word: 'friend', punctuated_word: 'friend.', start: 0.4, end: 0.7, speaker: 4 },
            ],
          },
        ],
      },
    });
    expect(out.isFinal).toBe(true);
    // No `paragraphs` block in the message → all words get the -1 sentinel
    // (V075 ROADMAP_01) so the V075 grouping/auto-merge fast-path is skipped
    // and V073 behaviour is preserved on responses without paragraphs.
    expect(out.words).toEqual([
      { text: 'Hi', startMs: 100, endMs: 200, deepgramSpeaker: 3, paragraphIndex: -1 },
      { text: 'there', startMs: 200, endMs: 400, deepgramSpeaker: 3, paragraphIndex: -1 },
      { text: 'friend.', startMs: 400, endMs: 700, deepgramSpeaker: 4, paragraphIndex: -1 },
    ]);
  });

  it('defaults missing speaker to 0', () => {
    const out = parseDeepgramWords({
      type: 'Results',
      is_final: true,
      channel: {
        alternatives: [
          {
            transcript: 'hi',
            words: [{ word: 'hi', start: 0, end: 0.1 }],
          },
        ],
      },
    });
    expect(out.words[0].deepgramSpeaker).toBe(0);
  });

  // ─── V075 ROADMAP_01: paragraph bucketing ────────────────────────────────

  it('paragraphs absent → every word gets paragraphIndex=-1 (sentinel for "no paragraph data")', () => {
    const out = parseDeepgramWords({
      type: 'Results',
      is_final: true,
      channel: {
        alternatives: [
          {
            transcript: 'a b c',
            words: [
              { word: 'a', start: 0.0, end: 0.1 },
              { word: 'b', start: 0.1, end: 0.2 },
              { word: 'c', start: 0.2, end: 0.3 },
            ],
          },
        ],
      },
    });
    expect(out.words.map((w) => w.paragraphIndex)).toEqual([-1, -1, -1]);
  });

  it('paragraphs present → words bucket by start time into the right index', () => {
    const out = parseDeepgramWords({
      type: 'Results',
      is_final: true,
      channel: {
        alternatives: [
          {
            transcript: 'one two three four five six',
            words: [
              { word: 'one', start: 0.0, end: 0.4 },
              { word: 'two', start: 0.4, end: 0.9 },
              { word: 'three', start: 1.2, end: 1.6 },
              { word: 'four', start: 1.6, end: 2.0 },
              { word: 'five', start: 2.6, end: 3.0 },
              { word: 'six', start: 3.0, end: 3.5 },
            ],
            paragraphs: {
              paragraphs: [
                { start: 0.0, end: 1.0 },
                { start: 1.2, end: 2.0 },
                { start: 2.5, end: 3.5 },
              ],
            },
          },
        ],
      },
    });
    expect(out.words.map((w) => w.paragraphIndex)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('word in a gap between paragraphs N and N+1 inherits paragraph N (trailing-silence rule)', () => {
    const out = parseDeepgramWords({
      type: 'Results',
      is_final: true,
      channel: {
        alternatives: [
          {
            transcript: 'gap',
            words: [{ word: 'gap', start: 1.05, end: 1.15 }],
            paragraphs: {
              paragraphs: [
                { start: 0.0, end: 1.0 },
                { start: 1.2, end: 2.0 },
              ],
            },
          },
        ],
      },
    });
    expect(out.words[0].paragraphIndex).toBe(0);
  });

  it('word preceding the first paragraph (interim edge) → paragraph 0', () => {
    const out = parseDeepgramWords({
      type: 'Results',
      is_final: true,
      channel: {
        alternatives: [
          {
            transcript: 'early',
            words: [{ word: 'early', start: 0.0, end: 0.05 }],
            paragraphs: {
              paragraphs: [{ start: 0.5, end: 1.0 }],
            },
          },
        ],
      },
    });
    expect(out.words[0].paragraphIndex).toBe(0);
  });

  it('word past the last paragraph end → last paragraph index', () => {
    const out = parseDeepgramWords({
      type: 'Results',
      is_final: true,
      channel: {
        alternatives: [
          {
            transcript: 'tail',
            words: [{ word: 'tail', start: 5.0, end: 5.2 }],
            paragraphs: {
              paragraphs: [
                { start: 0.0, end: 1.0 },
                { start: 1.2, end: 2.0 },
              ],
            },
          },
        ],
      },
    });
    expect(out.words[0].paragraphIndex).toBe(1);
  });
});
