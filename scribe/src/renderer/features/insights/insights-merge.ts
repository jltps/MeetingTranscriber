import type { InsightSentiment, MeetingInsights, PersistedSegment } from '../../../shared/types';

// Pure helper (V08): overlay Gladia's post-call insights onto the live transcript
// segments for the inline "weave" in TranscriptPanel. Insight entity offsets are
// native to each Gladia utterance's text, which differs from our stored segment
// text (energy "Me" splits/merges differently), so entity spans are recomputed by
// substring-matching the entity text within the *segment's own* text. Sentiment is
// carried from the max-overlap utterance. Side-effect free + unit-tested.

export type SegmentEntitySpan = { start: number; end: number; kind: string };

export type SegmentInsight = {
  entitySpans: SegmentEntitySpan[];
  sentiment?: InsightSentiment;
};

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** Locate each entity's text within the segment text → non-overlapping spans. */
function spansFor(segmentText: string, entities: { text: string; kind: string }[]): SegmentEntitySpan[] {
  const spans: SegmentEntitySpan[] = [];
  let cursor = 0;
  for (const e of entities) {
    if (!e.text) continue;
    let idx = segmentText.indexOf(e.text, cursor);
    if (idx < 0) idx = segmentText.indexOf(e.text);
    if (idx < 0) continue;
    const span = { start: idx, end: idx + e.text.length, kind: e.kind };
    // Skip if it overlaps a span already recorded (keep the earlier one).
    if (spans.some((s) => span.start < s.end && s.start < span.end)) continue;
    spans.push(span);
    cursor = Math.max(cursor, span.end);
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Build a per-segment-id overlay map. A segment with no overlapping insight
 * utterance is simply absent from the map (renders exactly as today).
 */
export function mergeInsightsIntoSegments(
  segments: readonly PersistedSegment[],
  insights: MeetingInsights | null,
): Map<number, SegmentInsight> {
  const out = new Map<number, SegmentInsight>();
  if (!insights || insights.status !== 'ready' || insights.utterances.length === 0) return out;

  for (const seg of segments) {
    let bestOverlap = 0;
    let bestSentiment: InsightSentiment | undefined;
    const entities: { text: string; kind: string }[] = [];
    for (const u of insights.utterances) {
      const ov = overlapMs(seg.startMs, seg.endMs, u.startMs, u.endMs);
      if (ov <= 0) continue;
      for (const e of u.entities) entities.push({ text: e.text, kind: e.kind });
      if (u.sentiment && ov > bestOverlap) {
        bestOverlap = ov;
        bestSentiment = u.sentiment;
      }
    }
    const entitySpans = spansFor(seg.text, entities);
    if (entitySpans.length > 0 || bestSentiment) {
      out.set(seg.id, { entitySpans, sentiment: bestSentiment });
    }
  }
  return out;
}
