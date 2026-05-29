/**
 * V081 — aggregateInsights tests. Pure: turns stored insight utterances into the
 * dashboard sections (speaker time + %, sentiment/emotion groupings with their
 * occurrences, top entities). No transcript re-render.
 */
import { describe, it, expect } from 'vitest';
import { aggregateInsights } from '../src/renderer/features/insights/insights-aggregate';
import type { InsightUtterance } from '../src/shared/types';

function u(over: Partial<InsightUtterance>): InsightUtterance {
  return {
    text: 'hi',
    speaker: 0,
    speakerLabel: 'Me',
    isMe: true,
    startMs: 0,
    endMs: 1000,
    channel: 0,
    entities: [],
    ...over,
  };
}

describe('aggregateInsights', () => {
  it('computes per-speaker talk time + percentage of total', () => {
    const agg = aggregateInsights([
      u({ speakerLabel: 'Me', startMs: 0, endMs: 3000 }),
      u({ speakerLabel: 'Speaker 1', startMs: 3000, endMs: 4000 }),
    ]);
    expect(agg.totalTalkMs).toBe(4000);
    const me = agg.speakers.find((s) => s.label === 'Me');
    const other = agg.speakers.find((s) => s.label === 'Speaker 1');
    expect(me).toMatchObject({ talkMs: 3000, pct: 75, utteranceCount: 1 });
    expect(other).toMatchObject({ talkMs: 1000, pct: 25 });
    // Sorted by talk time descending.
    expect(agg.speakers[0].label).toBe('Me');
  });

  it('groups sentiments + emotions with their occurrences and percentages', () => {
    const agg = aggregateInsights([
      u({ startMs: 0, endMs: 1000, sentiment: { label: 'positive', emotion: 'amusement' } }),
      u({ startMs: 1000, endMs: 2000, sentiment: { label: 'positive', emotion: 'amusement' } }),
      u({ startMs: 2000, endMs: 3000, sentiment: { label: 'mixed', emotion: 'confusion' } }),
      u({ startMs: 3000, endMs: 4000 }), // no sentiment — excluded from the denominators
    ]);
    const pos = agg.sentiments.find((s) => s.label === 'positive');
    const mixed = agg.sentiments.find((s) => s.label === 'mixed');
    expect(pos).toMatchObject({ count: 2, pct: 67 });
    expect(pos?.occurrences.map((o) => o.startMs)).toEqual([0, 1000]);
    expect(mixed).toMatchObject({ count: 1, pct: 33 });
    expect(agg.emotions.find((e) => e.emotion === 'amusement')).toMatchObject({ count: 2 });
    expect(agg.emotions.find((e) => e.emotion === 'confusion')).toMatchObject({ count: 1 });
  });

  it('counts entities once per utterance and records occurrences', () => {
    const agg = aggregateInsights([
      u({
        startMs: 0,
        endMs: 1000,
        entities: [
          { kind: 'organization', text: 'Acme' },
          { kind: 'organization', text: 'Acme' }, // repeated within one utterance → one occurrence
        ],
      }),
      u({ startMs: 5000, endMs: 6000, entities: [{ kind: 'organization', text: 'Acme' }] }),
      u({ startMs: 7000, endMs: 8000, entities: [{ kind: 'person', text: 'Ana' }] }),
    ]);
    const acme = agg.entities.find((e) => e.text === 'Acme');
    expect(acme).toMatchObject({ kind: 'organization', count: 2 });
    expect(acme?.occurrences.map((o) => o.startMs)).toEqual([0, 5000]);
    expect(agg.entities[0].text).toBe('Acme'); // most frequent first
  });
});
