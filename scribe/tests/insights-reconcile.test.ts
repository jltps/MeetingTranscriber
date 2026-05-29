/**
 * V08 — reconcileInsights tests. Pure: maps provider insights onto the persisted
 * transcript by time-overlap to recover "Me"/speaker, then rolls up the summary.
 */
import { describe, it, expect } from 'vitest';
import { reconcileInsights, type ReconcileSegment } from '../src/main/transcription/insights-reconcile';
import type { ProviderInsights } from '../src/main/transcription/parse-gladia';

function provider(utterances: ProviderInsights['utterances']): ProviderInsights {
  return { utterances };
}

describe('reconcileInsights', () => {
  it('labels an utterance "Me" when it overlaps a channel-0 segment most', () => {
    const segments: ReconcileSegment[] = [
      { channel: 0, speakerLabel: 'Me', startMs: 0, endMs: 1000 },
      { channel: 1, speakerLabel: 'Speaker 1', startMs: 2000, endMs: 3000 },
    ];
    const ins = provider([
      { text: 'mine', speaker: 0, startMs: 100, endMs: 900, channel: 1, entities: [] },
      { text: 'theirs', speaker: 1, startMs: 2100, endMs: 2900, channel: 1, entities: [] },
    ]);
    const out = reconcileInsights(ins, segments);
    expect(out.status).toBe('ready');
    expect(out.utterances[0]).toMatchObject({ isMe: true, speakerLabel: 'Me', channel: 0 });
    expect(out.utterances[1]).toMatchObject({ isMe: false, speakerLabel: 'Speaker 1', channel: 1 });
  });

  it('falls back to provider channel when no transcript overlap', () => {
    const ins = provider([
      { text: 'orphan', speaker: 0, startMs: 50, endMs: 100, channel: 0, entities: [] },
    ]);
    const out = reconcileInsights(ins, []);
    expect(out.utterances[0]).toMatchObject({ isMe: true, speakerLabel: 'Me' });
  });

  it('rolls up speakers, entities, and sentiment into the summary', () => {
    const segments: ReconcileSegment[] = [
      { channel: 0, speakerLabel: 'Me', startMs: 0, endMs: 1000 },
      { channel: 1, speakerLabel: 'Speaker 1', startMs: 1000, endMs: 2000 },
    ];
    const ins = provider([
      {
        text: 'I called Acme',
        speaker: 0,
        startMs: 0,
        endMs: 1000,
        channel: 1,
        entities: [{ kind: 'org', text: 'Acme' }],
        sentiment: { label: 'positive' },
      },
      {
        text: 'Acme replied',
        speaker: 1,
        startMs: 1000,
        endMs: 2000,
        channel: 1,
        entities: [{ kind: 'org', text: 'Acme' }],
        sentiment: { label: 'neutral' },
      },
    ]);
    const out = reconcileInsights(ins, segments);
    // V081: sentiment is now a record keyed only by labels that occurred.
    expect(out.summary.sentiment).toEqual({ positive: 1, neutral: 1 });
    expect(out.summary.entityCounts).toEqual([{ kind: 'org', count: 2 }]);
    expect(out.summary.topEntities[0]).toEqual({ text: 'Acme', kind: 'org', count: 2 });
    expect(out.summary.speakers.map((s) => s.label).sort()).toEqual(['Me', 'Speaker 1']);
  });
});
