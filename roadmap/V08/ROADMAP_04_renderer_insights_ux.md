# ROADMAP_04 — Renderer: settings + Insights view + inline weave

Implements §13 of the guide **both** ways: a dedicated post-call Insights
view *and* inline NER/sentiment woven into the live transcript.

## Settings — `renderer/features/settings/SettingsModal.tsx` + `KeyRow.tsx`

- **Provider toggle** (`:463-493`): add a third `ToggleGroupItem value="gladia"`
  ("Gladia (cloud)"). Update the local `provider` state type (`:125`) and
  `handleSetProvider` (`:150`) to `'deepgram' | 'whisper' | 'gladia'`. Add
  help copy: streams audio to Gladia's cloud; needs a Gladia key; produces
  post-call diarization, entities, and sentiment.
- **API keys section** (`:287`): add `<KeyRow label="Gladia" provider="gladia"
  isSet={settings.gladiaKeySet} onSaved={onChanged} />`. `KeyRow` already keys
  its save on `provider` — extend its `setKeys` mapping to send `{ gladia: value }`
  when `provider === 'gladia'`, and `test` already routes through
  `settings.test(provider, …)`.
- **Privacy copy (honesty):** the privacy section currently says audio is sent
  to Deepgram. Make it provider-aware — name the *selected* transcription
  provider (Deepgram/Gladia cloud, or "stays on your machine" for Whisper).

## App shell — `renderer/app/App.tsx`

- **Insights view:** extend the note-window view union (`:94`,
  `'original' | 'enhanced'`) with `'insights'`. Surface the Insights toggle in
  `NoteWindowHeader` **only when** insights exist or are processing (from
  `use-insights`). While `status === 'processing'`, show an "Analysing…"
  affordance; on `'ready'`, enable the view; on `'error'`, a quiet retry note.
- **Provider-aware key guard** (`:731`): the EmptyState "connect keys" check
  currently tests `deepgramKeySet`. Make it provider-aware:
  Deepgram→`deepgramKeySet`, Gladia→`gladiaKeySet`, Whisper→none (plus
  `anthropicKeySet` for enhancement, unchanged).
- **Surface start failures:** the `start()` catch (`:389`) currently rolls back
  silently. Set the visible `transcription.error` (already in
  `use-transcription.ts:26`) so a Gladia/Deepgram no-key or init failure tells
  the user instead of silently doing nothing.

## New feature — `renderer/features/insights/`

- **`use-insights.ts`** — `useInsights(meetingId)`: fetch via
  `window.api.meetings.getInsights`; subscribe to
  `onTranscriptionInsightsStatus` and **re-fetch on a matching `meetingId`**
  (push is advisory). Returns `{ insights, status, loading }`.
- **`InsightsView.tsx`** — renders normalized utterances using the entity char
  offsets computed in `parse-gladia` (native to each utterance's `text`):
  speaker color (reuse `text-speaker-self`/`text-speaker-other`), inline NER
  tags (kind-colored), a per-utterance sentiment glyph (😊/😐/😟 + label).
  Mirror the virtualized list style of `TranscriptPanel`.
- **`InsightsSummary.tsx`** — header card: speakers + talk-time, entity counts
  by kind + top entities, sentiment distribution bar. From
  `MeetingInsights.summary`.
- **`insights-merge.ts`** (pure, unit-tested) — `mergeInsightsIntoSegments(
  segments: PersistedSegment[], insights: MeetingInsights)` → per-segment
  `{ entitySpans: {start,end,kind}[]; sentiment?: InsightSentiment }` by
  time-overlapping each segment with insight utterances and **substring-matching
  entity text within the segment's own text** (so offsets are correct against
  what the live panel renders). Used for the inline weave.

## Live transcript weave — `renderer/features/transcript/TranscriptPanel.tsx`

`renderSegmentText` (`:35-74`) already overlays char-offset spans (fillers) and
paragraph breaks. Extend it to also overlay **NER underline spans** (kind-colored
`<span>`s, merged with the existing filler-span weaving — keep spans sorted +
non-overlapping; if a filler and entity overlap, entity wins). Add a small
**per-line sentiment glyph** near the speaker label. Both are gated on optional
props the parent passes only when insights exist (computed by `insights-merge`),
so non-Gladia meetings render exactly as today.

## Styling — `renderer/app/index.css`

Add semantic tokens (Tailwind v4 `@theme`, matching the existing
`--color-speaker-*` style): NER-kind colors (`--color-entity-person`,
`-organization`, `-location`, `-date`, `-other`…) and sentiment colors
(`--color-sentiment-positive|neutral|negative`). Light + dark.

## Verification (live `corepack pnpm dev`)

1. Settings → enter Gladia key → **Test** ok → select **Gladia**.
2. Run a meeting (mic + system audio). Live partial+final transcript appears;
   mic indicator off on Stop; no key/URL in logs; no audio file on disk.
3. After Stop: "Analysing…" → Insights view shows speaker colors, inline NER
   tags, per-utterance sentiment + summary; the live transcript shows inline
   NER underlines + sentiment glyphs (the weave).
4. Switch to Deepgram and Whisper → both unchanged; no Insights affordance.
