import { describe, it, expect } from 'vitest';
import { parseDeepgramMessage } from '../src/main/transcription/parse';

describe('parseDeepgramMessage', () => {
  it('ignores non-Results messages and empty transcripts', () => {
    expect(parseDeepgramMessage({ type: 'Metadata' })).toEqual([]);
    expect(
      parseDeepgramMessage({
        type: 'Results',
        channel_index: [0, 2],
        channel: { alternatives: [{ transcript: '   ' }] },
      }),
    ).toEqual([]);
  });

  it('labels channel 0 as "Me" regardless of diarization', () => {
    const segs = parseDeepgramMessage({
      type: 'Results',
      channel_index: [0, 2],
      is_final: true,
      start: 1.0,
      duration: 0.5,
      channel: { alternatives: [{ transcript: 'hello there', words: [] }] },
    });
    expect(segs).toEqual([
      { text: 'hello there', channel: 0, speakerLabel: 'Me', startMs: 1000, endMs: 1500, isFinal: true },
    ]);
  });

  it('keeps an interim channel-1 result as a single in-progress line', () => {
    const segs = parseDeepgramMessage({
      type: 'Results',
      channel_index: [1, 2],
      is_final: false,
      start: 2.0,
      duration: 0.4,
      channel: { alternatives: [{ transcript: 'we should', words: [{ word: 'we', start: 2.0, end: 2.2, speaker: 0 }] }] },
    });
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ channel: 1, speakerLabel: 'Speaker 1', isFinal: false, text: 'we should' });
  });

  it('splits a finalized channel-1 result into per-speaker runs', () => {
    const segs = parseDeepgramMessage({
      type: 'Results',
      channel_index: [1, 2],
      is_final: true,
      start: 3.0,
      duration: 2.0,
      channel: {
        alternatives: [
          {
            transcript: 'yes exactly no',
            words: [
              { word: 'yes', punctuated_word: 'Yes,', start: 3.0, end: 3.3, speaker: 0 },
              { word: 'exactly', punctuated_word: 'exactly.', start: 3.3, end: 3.9, speaker: 0 },
              { word: 'no', punctuated_word: 'No.', start: 4.0, end: 4.4, speaker: 1 },
            ],
          },
        ],
      },
    });
    expect(segs).toEqual([
      { text: 'Yes, exactly.', channel: 1, speakerLabel: 'Speaker 1', startMs: 3000, endMs: 3900, isFinal: true },
      { text: 'No.', channel: 1, speakerLabel: 'Speaker 2', startMs: 4000, endMs: 4400, isFinal: true },
    ]);
  });
});
