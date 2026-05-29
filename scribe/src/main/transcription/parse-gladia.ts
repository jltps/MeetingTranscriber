import type {
  LiveV2NamedEntityRecognitionData,
  LiveV2NamedEntityRecognitionResult,
  LiveV2SentimentAnalysisData,
  LiveV2SentimentAnalysisResult,
  LiveV2TranscriptMessageData,
  LiveV2Utterance,
} from '@gladiaio/sdk';
import type { InsightEntity, InsightSentiment } from '../../shared/types';

// Pure mapping from accumulated Gladia live-session messages to the app's
// normalized post-call insight shape (V08). Kept side-effect free + provider-
// shaped only here so it can be unit-tested without the SDK socket (mirrors the
// role of parse.ts for Deepgram). The IPC layer reconciles "Me"/speaker labels
// against the persisted transcript afterwards (the energy timeline is gone by
// then) — this module never touches the DB.
//
// SDK reality (vs the guide): diarization/NER/sentiment arrive over the
// WebSocket as `transcript` (final) / `named_entity_recognition` /
// `sentiment_analysis` messages, each keyed by an utterance id and carrying the
// utterance. There is no separate GET on the normal path. NER/sentiment results
// carry no confidence; entity char offsets are derived by substring-matching the
// entity text within the utterance text (the API start/end semantics are
// ambiguous, so they are not trusted for rendering).

/** Per-sub-session accumulator the GladiaSession fills as messages arrive. */
export type GladiaAccumulator = {
  /** Utterance id → utterance (from `transcript` finals, backfilled by NER/sentiment). */
  utterances: Map<string, LiveV2Utterance>;
  /** Utterance id → NER results. */
  ner: Map<string, LiveV2NamedEntityRecognitionResult[]>;
  /** Utterance id → sentiment results. */
  sentiment: Map<string, LiveV2SentimentAnalysisResult[]>;
};

/** The pre-reconcile insight shape emitted by GladiaSession.onInsights. */
export type ProviderInsights = {
  utterances: Array<{
    text: string;
    /** Gladia diarization speaker id (0-indexed); -1 when absent. */
    speaker: number;
    startMs: number;
    endMs: number;
    channel: 0 | 1;
    language?: string;
    entities: InsightEntity[];
    sentiment?: InsightSentiment;
  }>;
};

export function createAccumulator(): GladiaAccumulator {
  return { utterances: new Map(), ner: new Map(), sentiment: new Map() };
}

/** Record a `transcript` message; only finals contribute to insights. */
export function recordTranscript(acc: GladiaAccumulator, data: LiveV2TranscriptMessageData): void {
  if (!data.is_final || !data.id) return;
  acc.utterances.set(data.id, data.utterance);
}

export function recordNer(acc: GladiaAccumulator, data: LiveV2NamedEntityRecognitionData): void {
  const id = data.utterance_id;
  if (!id) return;
  if (!acc.utterances.has(id) && data.utterance) acc.utterances.set(id, data.utterance);
  const existing = acc.ner.get(id) ?? [];
  acc.ner.set(id, existing.concat(data.results ?? []));
}

export function recordSentiment(
  acc: GladiaAccumulator,
  data: LiveV2SentimentAnalysisData,
): void {
  const id = data.utterance_id;
  if (!id) return;
  if (!acc.utterances.has(id) && data.utterance) acc.utterances.set(id, data.utterance);
  const existing = acc.sentiment.get(id) ?? [];
  acc.sentiment.set(id, existing.concat(data.results ?? []));
}

/** Map a Gladia sentiment string onto our 3-way label. */
function toSentimentLabel(raw: string): InsightSentiment['label'] {
  const s = raw.toLowerCase();
  if (s.startsWith('pos')) return 'positive';
  if (s.startsWith('neg')) return 'negative';
  return 'neutral';
}

/**
 * Compute entity char offsets by locating each entity's text within the
 * utterance text. A moving cursor handles repeated entities; unmatched entities
 * are still returned (without offsets) so the UI can show them as chips.
 */
export function mapEntities(
  utteranceText: string,
  results: readonly LiveV2NamedEntityRecognitionResult[],
): InsightEntity[] {
  const out: InsightEntity[] = [];
  let cursor = 0;
  for (const r of results) {
    if (!r || typeof r.text !== 'string' || r.text.length === 0) continue;
    const entity: InsightEntity = { kind: r.entity_type ?? 'unknown', text: r.text };
    let idx = utteranceText.indexOf(r.text, cursor);
    if (idx < 0) idx = utteranceText.indexOf(r.text); // retry from the start
    if (idx >= 0) {
      entity.start = idx;
      entity.end = idx + r.text.length;
      cursor = entity.end;
    }
    out.push(entity);
  }
  return out;
}

/** Reduce per-sentence sentiment results to a single dominant label + emotion. */
export function mapSentiment(
  results: readonly LiveV2SentimentAnalysisResult[],
): InsightSentiment | undefined {
  if (!results || results.length === 0) return undefined;
  const counts: Record<InsightSentiment['label'], number> = { positive: 0, negative: 0, neutral: 0 };
  for (const r of results) counts[toSentimentLabel(r.sentiment ?? 'neutral')]++;
  let label: InsightSentiment['label'] = 'neutral';
  let best = -1;
  for (const key of ['positive', 'negative', 'neutral'] as const) {
    if (counts[key] > best) {
      best = counts[key];
      label = key;
    }
  }
  const match = results.find((r) => toSentimentLabel(r.sentiment ?? 'neutral') === label);
  const sentiment: InsightSentiment = { label };
  if (match?.emotion) sentiment.emotion = match.emotion;
  return sentiment;
}

/**
 * Merge one or more sub-session accumulators (a 3-hour handoff produces several)
 * into a single, time-ordered ProviderInsights. Each part's timestamps are
 * offset by its cumulative `baseOffsetMs` so the merged timeline is continuous.
 * Entity char offsets are within each utterance's own text, so they are
 * unaffected by the time merge.
 */
export function normalizeGladia(
  parts: ReadonlyArray<{ acc: GladiaAccumulator; baseOffsetMs: number }>,
): ProviderInsights {
  const utterances: ProviderInsights['utterances'] = [];
  for (const { acc, baseOffsetMs } of parts) {
    for (const [id, utt] of acc.utterances) {
      const entities = mapEntities(utt.text, acc.ner.get(id) ?? []);
      const sentiment = mapSentiment(acc.sentiment.get(id) ?? []);
      utterances.push({
        text: utt.text,
        speaker: typeof utt.speaker === 'number' ? utt.speaker : -1,
        startMs: Math.round(utt.start * 1000 + baseOffsetMs),
        endMs: Math.round(utt.end * 1000 + baseOffsetMs),
        channel: utt.channel === 0 ? 0 : 1,
        language: utt.language,
        entities,
        sentiment,
      });
    }
  }
  utterances.sort((a, b) => a.startMs - b.startMs);
  return { utterances };
}
