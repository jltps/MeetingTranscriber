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

  it('projects each word to {text, startMs, endMs, deepgramSpeaker}', () => {
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
    expect(out.words).toEqual([
      { text: 'Hi', startMs: 100, endMs: 200, deepgramSpeaker: 3 },
      { text: 'there', startMs: 200, endMs: 400, deepgramSpeaker: 3 },
      { text: 'friend.', startMs: 400, endMs: 700, deepgramSpeaker: 4 },
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
});
