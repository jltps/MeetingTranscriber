/**
 * V08 — pure Gladia normalizer tests (parse-gladia.ts). No SDK socket: synthetic
 * accumulators stand in for the live message stream. Covers final-only recording,
 * NER substring offsets, sentiment reduction, and the multi-sub-session (handoff)
 * merge with a cumulative time offset.
 */
import { describe, it, expect } from 'vitest';
import type {
  LiveV2NamedEntityRecognitionResult,
  LiveV2SentimentAnalysisResult,
  LiveV2Utterance,
} from '@gladiaio/sdk';
import {
  createAccumulator,
  mapEntities,
  mapSentiment,
  normalizeGladia,
  recordNer,
  recordSentiment,
  recordTranscript,
} from '../src/main/transcription/parse-gladia';

function utt(over: Partial<LiveV2Utterance> = {}): LiveV2Utterance {
  return {
    start: 0,
    end: 1,
    confidence: 0.9,
    channel: 0,
    words: [],
    text: 'hello world',
    language: 'en',
    ...over,
  };
}

describe('recordTranscript', () => {
  it('keeps only final utterances', () => {
    const acc = createAccumulator();
    recordTranscript(acc, { id: 'a', is_final: false, utterance: utt({ text: 'partial' }) });
    recordTranscript(acc, { id: 'b', is_final: true, utterance: utt({ text: 'final' }) });
    expect([...acc.utterances.keys()]).toEqual(['b']);
  });
});

describe('mapEntities', () => {
  it('computes char offsets by substring match and keeps unmatched as offset-less', () => {
    const results: LiveV2NamedEntityRecognitionResult[] = [
      { entity_type: 'person', text: 'Ana', start: 0, end: 0 },
      { entity_type: 'org', text: 'Acme', start: 0, end: 0 },
      { entity_type: 'date', text: 'nowhere', start: 0, end: 0 },
    ];
    const spans = mapEntities('Ana joined Acme today', results);
    expect(spans[0]).toEqual({ kind: 'person', text: 'Ana', start: 0, end: 3 });
    expect(spans[1]).toEqual({ kind: 'org', text: 'Acme', start: 11, end: 15 });
    expect(spans[2]).toEqual({ kind: 'date', text: 'nowhere' }); // no offsets — not present
  });

  it('advances the cursor for repeated entity text', () => {
    const results: LiveV2NamedEntityRecognitionResult[] = [
      { entity_type: 'org', text: 'go', start: 0, end: 0 },
      { entity_type: 'org', text: 'go', start: 0, end: 0 },
    ];
    const spans = mapEntities('go go go', results);
    expect(spans[0].start).toBe(0);
    expect(spans[1].start).toBe(3);
  });
});

describe('mapSentiment', () => {
  it('returns the dominant label with emotion', () => {
    const results: LiveV2SentimentAnalysisResult[] = [
      { sentiment: 'positive', emotion: 'joy', text: '', start: 0, end: 0, channel: 0 },
      { sentiment: 'positive', emotion: 'joy', text: '', start: 0, end: 0, channel: 0 },
      { sentiment: 'negative', emotion: 'anger', text: '', start: 0, end: 0, channel: 0 },
    ];
    expect(mapSentiment(results)).toEqual({ label: 'positive', emotion: 'joy' });
  });

  it('returns undefined for no results', () => {
    expect(mapSentiment([])).toBeUndefined();
  });
});

describe('normalizeGladia', () => {
  it('maps a single sub-session: seconds→ms, channel, speaker fallback', () => {
    const acc = createAccumulator();
    recordTranscript(acc, {
      id: 'u1',
      is_final: true,
      utterance: utt({ start: 1.5, end: 2.5, channel: 1, speaker: undefined, text: 'remote line' }),
    });
    const { utterances } = normalizeGladia([{ acc, baseOffsetMs: 0 }]);
    expect(utterances).toHaveLength(1);
    expect(utterances[0]).toMatchObject({
      text: 'remote line',
      channel: 1,
      speaker: -1,
      startMs: 1500,
      endMs: 2500,
      entities: [],
    });
  });

  it('attaches NER + sentiment by utterance id', () => {
    const acc = createAccumulator();
    recordTranscript(acc, { id: 'u1', is_final: true, utterance: utt({ text: 'Call Ana now' }) });
    recordNer(acc, {
      utterance_id: 'u1',
      utterance: utt({ text: 'Call Ana now' }),
      results: [{ entity_type: 'person', text: 'Ana', start: 0, end: 0 }],
    });
    recordSentiment(acc, {
      utterance_id: 'u1',
      utterance: utt({ text: 'Call Ana now' }),
      results: [{ sentiment: 'neutral', emotion: 'calm', text: '', start: 0, end: 0, channel: 0 }],
    });
    const { utterances } = normalizeGladia([{ acc, baseOffsetMs: 0 }]);
    expect(utterances[0].entities).toEqual([{ kind: 'person', text: 'Ana', start: 5, end: 8 }]);
    expect(utterances[0].sentiment).toEqual({ label: 'neutral', emotion: 'calm' });
  });

  it('merges two sub-sessions with a cumulative offset and sorts by time', () => {
    const a = createAccumulator();
    recordTranscript(a, { id: 'a1', is_final: true, utterance: utt({ start: 0, end: 1, text: 'first' }) });
    const b = createAccumulator();
    recordTranscript(b, { id: 'b1', is_final: true, utterance: utt({ start: 0, end: 1, text: 'second' }) });
    const { utterances } = normalizeGladia([
      { acc: a, baseOffsetMs: 0 },
      { acc: b, baseOffsetMs: 9_000_000 }, // 2.5h handoff offset
    ]);
    expect(utterances.map((u) => u.text)).toEqual(['first', 'second']);
    expect(utterances[1].startMs).toBe(9_000_000);
  });
});
