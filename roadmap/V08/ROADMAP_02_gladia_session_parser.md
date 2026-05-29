# ROADMAP_02 — GladiaSession + pure parser

The provider implementation. **All `@gladiaio/sdk` imports live in
`gladia.ts` + `parse-gladia.ts` only**, so the SDK can change without
rippling past these files.

## `session.ts` — extend the interface

Add an optional callback parallel to `onWords?` (`session.ts:21`):

```ts
/**
 * Fires once after the session ends with the normalized post-call
 * intelligence (diarization + NER + sentiment). Optional: only the Gladia
 * session implements it. The IPC layer reconciles "Me" + persists.
 */
onInsights?(cb: (insights: ProviderInsights) => void): void;
```

Import `ProviderInsights` from `./parse-gladia`.

## `parse-gladia.ts` (new, **pure, unit-tested**)

The SDK delivers, over the `message` event, per-utterance `transcript`
(final), `named_entity_recognition`, and `sentiment_analysis` messages (each
with `utterance_id` + embedded `utterance`), plus a comprehensive
`post_final_transcript` (`LiveV2TranscriptionResult`) at end. This module is
the pure mapping from *accumulated* SDK data → normalized `ProviderInsights`.

```ts
export type ProviderInsights = {
  utterances: Array<{
    text: string; speaker: number; startMs: number; endMs: number; channel: 0 | 1;
    language?: string; entities: InsightEntity[]; sentiment?: InsightSentiment;
  }>;
};

// Accumulator the session fills as messages arrive (keyed by utterance_id):
export type GladiaAccumulator = {
  finals: Map<string, LiveV2Utterance>;                       // from `transcript` is_final
  ner:    Map<string, LiveV2NamedEntityRecognitionResult[]>;  // from `named_entity_recognition`
  sentiment: Map<string, LiveV2SentimentAnalysisResult[]>;    // from `sentiment_analysis`
};

// Merge N sub-session accumulators (handoff) with per-sub-session offsets:
export function normalizeGladia(
  parts: Array<{ acc: GladiaAccumulator; baseOffsetMs: number }>,
): ProviderInsights;
```

Rules:
- `startMs/endMs` = `utterance.start/end * 1000 + baseOffsetMs`.
- `channel`: `utterance.channel === 0 ? 0 : 1`; `speaker`:
  `utterance.speaker ?? -1`.
- `language`: `utterance.language`.
- **Entities:** for each NER result, set `kind = entity_type`, `text`, and
  compute char offsets by substring-matching `text` within `utterance.text`
  (robust regardless of the API's `start/end` unit); keep raw `start/end`
  optional. Sort by offset; drop non-matching strays.
- **Sentiment:** map the dominant result's `sentiment` string →
  `{positive|negative|neutral}` (lowercase contains-match, default neutral);
  carry `emotion`. (If multiple sentence-level results per utterance, pick the
  most frequent / first.)
- Output utterances sorted by `startMs`. Pure — no SDK client, no I/O.

## `gladia.ts` (new) — `GladiaSession implements TranscriptionSession`

Modeled on `DeepgramSession` but simpler (SDK reconnects internally).

```ts
export type GladiaConfig = {
  apiKey: string;
  languageSetting?: LanguageSetting;
  onLanguageDetected?: (bcp47: string) => void;
  onStatus?: (status: TranscriptionStatus) => void;
};
```

**Config built for `startSession(LiveV2InitRequest)`:**
- `model: 'solaria-1'`, `encoding: 'wav/pcm'`, `bit_depth: 16`,
  `sample_rate` (from `start()` opts — note `LiveV2SampleRate` is a union;
  the worklet targets 16000), `channels` (from opts).
- `language_config`: `auto` → `{ languages: [], code_switching: true }`;
  `fixed` → `{ languages: [toIso639_1(bcp47)] }`. **Never default `['en']`
  (§1.7).** Add a `toIso639_1('pt-PT') → 'pt'` helper (strip region, lowercase);
  validate against `LiveV2TranscriptionLanguageCode` and omit `languages` if
  unmappable (→ auto-detect) rather than guessing English.
- `realtime_processing: { named_entity_recognition: true, sentiment_analysis: true }`.
  (There is **no** top-level `diarization` field; rely on `utterance.speaker`.)
- `messages_config: { receive_partial_transcripts: true, receive_final_transcripts: true,
  receive_realtime_processing_events: true, receive_post_processing_events: true }`.

**Live mapping (`message` event, discriminate on `message.type`):**
- `transcript`: `data.utterance` → `TranscriptSegment` (×1000 + offset).
  `is_final===false` → `onPartial`; `true` → `onFinal` **and** record into the
  current sub-session accumulator's `finals`. `speakerLabel`:
  `utterance.speaker` → `Speaker N` (or `Speaker`); **default `channel: 1`**
  in mono (energy "Me" reassigns downstream — matches `parse.ts:139-141`);
  honor `utterance.channel` (0 = mic = "Me") when 2-channel. Always emit a
  valid `0|1` channel.
- `named_entity_recognition` / `sentiment_analysis`: store `data.results` under
  `data.utterance_id` in the accumulator (and stash `data.utterance` if the
  matching final wasn't seen). Not emitted live to the renderer in V08.
- `post_final_transcript`: authoritative end-of-session payload — can be used
  to backfill any missing utterances/entities, but the accumulator already has
  them from realtime messages; treat as a completeness check.
- Fire `onLanguageDetected(utterance.language)` once (first final).

**Status mapping (`onStatus`):** `started`/`connected` → `open`;
`connecting` → `reconnecting`; `ended` → `closed`; `error` → `error`. Never
log the `started` payload `url` (it carries the session token).

**Audio:** `pushAudio(pcm: Int16Array)` → `session.sendAudio(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength))`.
Reject `start()` on empty `apiKey` (mirror `deepgram.ts:178-182`).

**Handoff (~2.5h):** internal timer → `current.stopRecording()` (lets that
sub-session post-process) + `startSession()` a fresh sub-session with
`baseOffsetMs += elapsed`. Add `baseOffsetMs` to every live emission. Keep an
array `subSessions: { session, acc, sessionId, baseOffsetMs }[]`.

**Retention after stop (critical):** `stop()` calls `stopRecording()` on the
current sub-session but **keeps the session(s) alive** until every
sub-session's `ended` fires; then `normalizeGladia(subSessions)` →
`onInsights(result)` and fully tear down (`removeAllListeners`). `getSessionId()`
promises feed `session_ids_json`. Guard so a late `ended` after a forced
`endSession()` (app quit) doesn't throw.

**`testGladiaKey(apiKey)`** — lightweight REST check (mirror `testDeepgramKey`,
`deepgram.ts:114-119`): a cheap authenticated GET with `x-gladia-key`; throw on
non-2xx.

## `gladia-results.ts` (new) — GET fallback for boot-resume only

`fetchGladiaResults(sessionId, apiKey): Promise<ProviderInsights>` — plain
`fetch('https://api.gladia.io/v2/live/' + sessionId, { headers: { 'x-gladia-key': apiKey } })`,
parse the returned `LiveV2TranscriptionResult`-shaped body into `ProviderInsights`
via a small adapter that reuses `normalizeGladia`'s mapping helpers. ⚠ The GET
body shape is unverified at write time — keep parsing defensive and used only by
the ROADMAP_05 resume path (the normal path never calls this).

## `transcription/index.ts` — factory branch

Add a `'gladia'` branch to `createTranscriptionSession` (`:32`):
```ts
if (provider === 'gladia') {
  const session = new GladiaSession({
    apiKey: getGladiaKey() ?? '',
    languageSetting: getLanguage(),
    onLanguageDetected: config.onLanguageDetected,
    onStatus: config.onStatus,
  });
  session.onPartial(config.onSegment);
  session.onFinal(config.onSegment);
  if (config.onInsights) session.onInsights(config.onInsights);
  return session;
}
```
Add `onInsights?` to `TranscriptionSessionConfig` (parallel to `onWords?`).

## Verification

`parse-gladia.ts` is fully unit-tested (ROADMAP_06) with synthetic message
fixtures, including a two-sub-session merge with a non-zero offset. The session
itself is verified on a live call (ROADMAP_04 verification).
