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

  // Regression guard for the merged-speaker bug: diarize=true (now sent by
  // deepgram.ts) populates word.speaker on the system channel, so two remote
  // participants must surface as distinct labels rather than collapsing into one.
  it('keeps three distinct system-channel speakers separate', () => {
    const segs = parseDeepgramMessage({
      type: 'Results',
      channel_index: [1, 2],
      is_final: true,
      start: 10.0,
      duration: 3.0,
      channel: {
        alternatives: [
          {
            transcript: 'ola tudo bem otimo',
            words: [
              { word: 'ola', punctuated_word: 'Olá,', start: 10.0, end: 10.4, speaker: 0 },
              { word: 'tudo', punctuated_word: 'tudo', start: 10.5, end: 10.8, speaker: 1 },
              { word: 'bem', punctuated_word: 'bem?', start: 10.8, end: 11.1, speaker: 1 },
              { word: 'otimo', punctuated_word: 'Ótimo.', start: 11.3, end: 11.8, speaker: 2 },
            ],
          },
        ],
      },
    });
    expect(segs.map((s) => s.speakerLabel)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 3']);
    expect(segs.map((s) => s.text)).toEqual(['Olá,', 'tudo bem?', 'Ótimo.']);
  });

  // V05 ROADMAP_02: single-channel (mono) mode. The mic channel is no longer a
  // dedicated "Me" channel — channel 0 carries everyone and is split by speaker.
  // "Me" is recovered later in main from the mic-energy signal (see me-attribution).
  describe('single-channel (mono) mode', () => {
    it('does NOT treat channel 0 as "Me" — splits it by diarization speaker', () => {
      const segs = parseDeepgramMessage(
        {
          type: 'Results',
          channel_index: [0, 1],
          is_final: true,
          start: 0,
          duration: 2.0,
          channel: {
            alternatives: [
              {
                transcript: 'hi yes',
                words: [
                  { word: 'hi', punctuated_word: 'Hi.', start: 0.0, end: 0.4, speaker: 0 },
                  { word: 'yes', punctuated_word: 'Yes.', start: 1.0, end: 1.4, speaker: 1 },
                ],
              },
            ],
          },
        },
        { singleChannel: true },
      );
      expect(segs).toEqual([
        { text: 'Hi.', channel: 1, speakerLabel: 'Speaker 1', startMs: 0, endMs: 400, isFinal: true },
        { text: 'Yes.', channel: 1, speakerLabel: 'Speaker 2', startMs: 1000, endMs: 1400, isFinal: true },
      ]);
    });

    it('emits an interim channel-0 line as "Speaker N", not "Me"', () => {
      const segs = parseDeepgramMessage(
        {
          type: 'Results',
          channel_index: [0, 1],
          is_final: false,
          start: 2.0,
          duration: 0.4,
          channel: {
            alternatives: [{ transcript: 'we should', words: [{ word: 'we', start: 2.0, end: 2.2, speaker: 0 }] }],
          },
        },
        { singleChannel: true },
      );
      expect(segs).toHaveLength(1);
      expect(segs[0]).toMatchObject({ channel: 1, speakerLabel: 'Speaker 1', isFinal: false });
    });
  });
});
