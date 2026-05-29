import { z } from 'zod';
import type { InsightEntity, InsightSentiment } from '../../shared/types';
import type { ProviderInsights } from './parse-gladia';

// V08 — GET-based fallback used ONLY by the boot-resume path (the normal live
// path collects everything over the WebSocket via parse-gladia). If the app
// closes during Gladia's brief post-processing, the `post_final_transcript`
// message is lost; this re-fetches the finished result from the REST endpoint.
//
// The exact REST body shape is not pinned by the SDK types, so it is parsed
// defensively (lenient + passthrough). Entity offsets are recomputed by
// substring match against the utterance text, matching parse-gladia. The key is
// sent in the `x-gladia-key` header and never logged (§1.2).

const RestEntitySchema = z
  .object({
    // The REST API has used both names across versions; accept either.
    entity_kind: z.string().optional(),
    entity_type: z.string().optional(),
    text: z.string(),
  })
  .passthrough();

const RestSentimentSchema = z
  .object({ sentiment: z.string().optional(), emotion: z.string().optional() })
  .passthrough();

const RestUtteranceSchema = z
  .object({
    text: z.string(),
    start: z.number(),
    end: z.number(),
    channel: z.number().optional(),
    speaker: z.number().optional(),
    language: z.string().optional(),
    named_entity_recognition: z
      .object({ results: z.array(RestEntitySchema).nullable().optional() })
      .nullable()
      .optional(),
    sentiment_analysis: z
      .object({ results: z.array(RestSentimentSchema).nullable().optional() })
      .nullable()
      .optional(),
  })
  .passthrough();

const RestResultSchema = z
  .object({
    result: z
      .object({
        transcription: z.object({ utterances: z.array(RestUtteranceSchema) }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

function mapEntities(text: string, results: z.infer<typeof RestEntitySchema>[]): InsightEntity[] {
  const out: InsightEntity[] = [];
  let cursor = 0;
  for (const r of results) {
    if (!r.text) continue;
    const entity: InsightEntity = { kind: r.entity_kind ?? r.entity_type ?? 'unknown', text: r.text };
    let idx = text.indexOf(r.text, cursor);
    if (idx < 0) idx = text.indexOf(r.text);
    if (idx >= 0) {
      entity.start = idx;
      entity.end = idx + r.text.length;
      cursor = entity.end;
    }
    out.push(entity);
  }
  return out;
}

function mapSentiment(results: z.infer<typeof RestSentimentSchema>[]): InsightSentiment | undefined {
  if (results.length === 0) return undefined;
  const first = results[0];
  const s = (first.sentiment ?? 'neutral').toLowerCase();
  const label: InsightSentiment['label'] = s.startsWith('pos')
    ? 'positive'
    : s.startsWith('neg')
      ? 'negative'
      : 'neutral';
  const sentiment: InsightSentiment = { label };
  if (first.emotion) sentiment.emotion = first.emotion;
  return sentiment;
}

/**
 * Fetch + normalize one finished Gladia live session. `baseOffsetMs` lets the
 * resume path stitch multiple sub-sessions (a handoff) onto a continuous
 * timeline — though sub-session offsets aren't persisted, so multi-session
 * resume is best-effort (single-session resume is exact).
 */
export async function fetchGladiaResults(
  sessionId: string,
  apiKey: string,
  baseOffsetMs = 0,
): Promise<ProviderInsights> {
  const res = await fetch(`https://api.gladia.io/v2/live/${sessionId}`, {
    headers: { 'x-gladia-key': apiKey },
  });
  if (!res.ok) throw new Error(`Gladia results fetch failed (HTTP ${res.status}).`);
  const parsed = RestResultSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error('Unexpected Gladia results shape.');

  const utterances = parsed.data.result.transcription.utterances.map((u) => ({
    text: u.text,
    speaker: typeof u.speaker === 'number' ? u.speaker : -1,
    startMs: Math.round(u.start * 1000 + baseOffsetMs),
    endMs: Math.round(u.end * 1000 + baseOffsetMs),
    channel: (u.channel === 0 ? 0 : 1) as 0 | 1,
    language: u.language,
    entities: mapEntities(u.text, u.named_entity_recognition?.results ?? []),
    sentiment: mapSentiment(u.sentiment_analysis?.results ?? []),
  }));
  return { utterances };
}
