# ROADMAP_01 — Data + settings plumbing

Lay the shared/data/secrets foundation so Gladia can be selected, keyed,
and its insights stored. **No behaviour change yet** — purely additive
types, schemas, a migration, and accessors.

## Migration v14 (`scribe/src/main/db/migrations.ts`)

Append after v13 (`transcript-segment-spans`). Additive only (CLAUDE.md §7):

```sql
CREATE TABLE meeting_insights (
  meeting_id       INTEGER PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  provider         TEXT    NOT NULL,            -- 'gladia'
  status           TEXT    NOT NULL,            -- 'processing' | 'ready' | 'error'
  insights_json    TEXT,                         -- normalized MeetingInsights; NULL until ready
  session_ids_json TEXT,                         -- ['id', ...] for handoff merge + boot-resume
  error            TEXT,
  updated_at       INTEGER NOT NULL
);
ALTER TABLE meetings ADD COLUMN stt_provider TEXT;   -- NULL = legacy/deepgram
```

`ON DELETE CASCADE` so insights die with the meeting; `meetings.stt_provider`
lets `getUsageTotals` price each meeting at the right rate (ROADMAP_05).

## `scribe/src/main/db/insights.ts` (new)

```ts
getInsights(meetingId): MeetingInsights | null            // parses insights_json, returns status even when null
saveInsights(meetingId, normalized: MeetingInsights, sessionIds: string[]): void  // status 'ready'
setInsightsProcessing(meetingId, provider, sessionIds: string[]): void            // status 'processing'
setInsightsError(meetingId, msg: string): void                                    // status 'error'
getPendingInsights(): { meetingId, provider, sessionIds: string[] }[]             // status='processing' rows, for boot-resume
```

Mirror the safe-JSON-parse pattern from `db/meetings.ts:310-361` (corrupt
JSON must not throw a read).

## `scribe/src/main/db/settings.ts`

- Extend `TranscriptionProvider` (`:161`): `'deepgram' | 'whisper' | 'gladia'`.
- `getTranscriptionProvider` (`:163`): accept `'gladia'` (`raw === 'whisper'`
  → whisper; `raw === 'gladia'` → gladia; else deepgram).
- `wipeAllData` (`:248`): add `db.prepare('DELETE FROM meeting_insights').run()`
  inside the transaction (the meetings delete cascades, but keep it explicit +
  ordered before `meetings`).

## `scribe/src/main/secrets/api-keys.ts`

Clone the Deepgram accessors:
```ts
const GLADIA_SETTING = 'gladia_key_enc';
export function getGladiaKey(): string | null { return readKey(GLADIA_SETTING, 'GLADIA_API_KEY'); }
export function setGladiaKey(key: string | null): void { storeKey(GLADIA_SETTING, key); }
```

## `scribe/src/shared/types.ts` (new types)

Note the SDK reality: NER/sentiment carry **no confidence**; sentiment has an
`emotion`; entity char offsets are best derived by substring-matching
`entity.text` within the utterance text (the API `start/end` semantics are
ambiguous, so store them optionally only).

```ts
export type InsightEntity = {
  kind: string;            // Gladia entity_type, e.g. 'person' | 'organization' | 'location' | 'date' …
  text: string;
  start?: number;          // optional raw offsets from the API (semantics unverified)
  end?: number;
};
export type InsightSentiment = {
  label: 'positive' | 'negative' | 'neutral';
  emotion?: string;        // Gladia emotion string when present
};
export type InsightUtterance = {
  text: string;
  speaker: number;         // Gladia diarization speaker id (0-indexed); -1 if absent
  speakerLabel: string;    // reconciled in IPC: 'Me' or 'Speaker N'
  isMe: boolean;
  startMs: number;
  endMs: number;
  channel: 0 | 1;
  language?: string;
  entities: InsightEntity[];   // entity char ranges computed against `text` (substring match)
  sentiment?: InsightSentiment;
};
export type MeetingInsightsSummary = {
  speakers: { label: string; talkMs: number; utteranceCount: number }[];
  entityCounts: { kind: string; count: number }[];
  topEntities: { text: string; kind: string; count: number }[];
  sentiment: { positive: number; neutral: number; negative: number };  // utterance counts
};
export type MeetingInsights = {
  provider: 'gladia';
  status: 'processing' | 'ready' | 'error';
  error?: string;
  utterances: InsightUtterance[];
  summary: MeetingInsightsSummary;
};
```

`ProviderInsights` (the pre-reconcile shape emitted by `GladiaSession.onInsights`)
is `MeetingInsights` minus the reconciled `speakerLabel`/`isMe` — define it in
`transcription/parse-gladia.ts` (ROADMAP_02), not in shared, since it never
crosses IPC.

## `scribe/src/shared/ipc-contract.ts`

- **Provider union edits:** `SettingsView.transcriptionProvider` (`:363`),
  `SettingsApi.setTranscriptionProvider` (`:499`), and the handler enum in
  `main/ipc/settings.ts:145` (a literal `z.enum([...])`). Add `'gladia'`.
- **Keys/test:** `SetKeysSchema` (`:219`) add `gladia: z.string().optional()`;
  `TestProviderSchema` (`:302`) add `'gladia'`; `SettingsView` add
  `gladiaKeySet: boolean`.
- **New channels** in the `IPC` map: `meetingsGetInsights: 'meetings:getInsights'`,
  `transcriptionInsightsStatus: 'transcription:insightsStatus'`.
- **New schemas:** `MeetingInsightsSchema` (Zod mirror of `MeetingInsights`,
  `satisfies z.ZodType<MeetingInsights>`), `InsightsStatusSchema`
  (`{ meetingId: MeetingIdSchema, status: z.enum(['processing','ready','error']) }`).
- **API surface:** `MeetingsApi.getInsights(meetingId): Promise<MeetingInsights | null>`;
  `ScribeApi.onTranscriptionInsightsStatus(cb): () => void`.

## Verification

`corepack pnpm typecheck` green (types compile; nothing consumes them yet).
A migration unit test (ROADMAP_06) proves v14 applies on a populated DB and
existing rows survive.
