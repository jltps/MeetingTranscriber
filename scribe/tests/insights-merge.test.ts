/**
 * V08 — mergeInsightsIntoSegments tests (renderer pure helper). Overlays Gladia
 * insights onto live transcript segments by time-overlap, recomputing entity
 * offsets against the segment's own text.
 */
import { describe, it, expect } from 'vitest';
import { mergeInsightsIntoSegments } from '../src/renderer/features/insights/insights-merge';
import type { MeetingInsights, PersistedSegment } from '../src/shared/types';

function seg(over: Partial<PersistedSegment> & { id: number }): PersistedSegment {
  return {
    text: 'hello',
    channel: 1,
    speakerLabel: 'Speaker 1',
    startMs: 0,
    endMs: 1000,
    isFinal: true,
    ...over,
  };
}

function insights(utterances: MeetingInsights['utterances']): MeetingInsights {
  return {
    provider: 'gladia',
    status: 'ready',
    utterances,
    summary: { speakers: [], entityCounts: [], topEntities: [], sentiment: { positive: 0, neutral: 0, negative: 0 } },
  };
}

describe('mergeInsightsIntoSegments', () => {
  it('overlays entity spans (recomputed against segment text) + sentiment by overlap', () => {
    const segments = [seg({ id: 7, text: 'Call Ana at Acme', startMs: 0, endMs: 2000 })];
    const ins = insights([
      {
        text: 'Call Ana at Acme',
        speaker: 1,
        speakerLabel: 'Speaker 1',
        isMe: false,
        startMs: 500,
        endMs: 1500,
        channel: 1,
        entities: [
          { kind: 'person', text: 'Ana', start: 5, end: 8 },
          { kind: 'org', text: 'Acme', start: 12, end: 16 },
        ],
        sentiment: { label: 'positive' },
      },
    ]);
    const map = mergeInsightsIntoSegments(segments, ins);
    const overlay = map.get(7);
    expect(overlay?.sentiment).toEqual({ label: 'positive' });
    expect(overlay?.entitySpans).toEqual([
      { start: 5, end: 8, kind: 'person' },
      { start: 12, end: 16, kind: 'org' },
    ]);
  });

  it('returns an empty map when insights are not ready', () => {
    const segments = [seg({ id: 1 })];
    const processing: MeetingInsights = { ...insights([]), status: 'processing' };
    expect(mergeInsightsIntoSegments(segments, processing).size).toBe(0);
    expect(mergeInsightsIntoSegments(segments, null).size).toBe(0);
  });

  it('omits segments with no overlapping utterance', () => {
    const segments = [seg({ id: 1, startMs: 0, endMs: 1000 })];
    const ins = insights([
      { text: 'later', speaker: 1, speakerLabel: 'Speaker 1', isMe: false, startMs: 5000, endMs: 6000, channel: 1, entities: [{ kind: 'org', text: 'x' }] },
    ]);
    expect(mergeInsightsIntoSegments(segments, ins).has(1)).toBe(false);
  });
});
