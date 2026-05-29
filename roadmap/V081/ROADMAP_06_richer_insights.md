# ROADMAP_06 — Richer insights + full sentiment/emotion taxonomy

Capture the real Gladia values and turn the Insights view into a dashboard — no
full transcript (that lives in the live transcript window).

## Widen the model
- `shared/types.ts`: `InsightSentiment.label` →
  `'positive' | 'negative' | 'neutral' | 'mixed' | 'unknown'`; keep `emotion?: string`.
  Change `MeetingInsightsSummary.sentiment` from the 3-field object to
  `Record<string, number>` and add `emotions: Record<string, number>`.
- `shared/ipc-contract.ts`: update `InsightSentimentSchema` (5-value enum) and
  `MeetingInsightsSummarySchema` (`sentiment` + `emotions` as `z.record`).

## Preserve real values
- `parse-gladia.ts` `mapSentiment`/`toSentimentLabel` and `gladia-results.ts`:
  map the Gladia `sentiment` string to the exact 5-value set (fallback `unknown`),
  keep `emotion` verbatim — stop the `startsWith` collapse. One dominant
  sentiment+emotion per utterance is retained (utterances carry `startMs/endMs`).
- `insights-reconcile.ts` `buildSummary`: emit the widened `sentiment` +
  `emotions` records (counts).

## Styling (`insight-style.ts` + `app/index.css`)
- Add `SENTIMENT_GLYPH` + color for `mixed` (🤔) and `unknown` (❔); add
  `--color-sentiment-mixed` / `--color-sentiment-unknown` tokens (light + dark).
- Add an emotion→emoji lookup for the 25 emotions (or a valence-grouped subset +
  neutral fallback).

## New aggregator (pure, unit-tested)
`renderer/features/insights/insights-aggregate.ts` — from `insights.utterances`:
- `speakers: [{ label, talkMs, pct, utteranceCount }]` (pct of total talk time),
- `sentiments: [{ label, count, pct, occurrences:[{startMs,endMs,text,speakerLabel}] }]`,
- `emotions: [{ emotion, count, pct, occurrences }]`,
- `entities: [{ text, kind, count, occurrences }]`.

## Redesign `InsightsView.tsx` (remove the utterance/transcript list)
- **Speakers** — one line each: *"José spoke for 1m42s, 43% of the talk time."*
  (`formatTalk`; names via `speakerNames`).
- **Sentiment** — each sentiment present: emoji + label + count + % + a short
  sentence; **expandable** (shadcn `Collapsible`) to occurrence times (mm:ss)
  that are **clickable → `onSeek`**. Emotions listed the same way.
- **Top entities** — kind-colored chip + text + count + a short line; expandable to
  occurrence times (clickable → `onSeek`).
- Fold/retire `InsightsSummary.tsx` into these sections.

## Export
- `ipc/export.ts` Insights section: use the new sentiment record + emotions and
  the speaker-% phrasing.

## Verify
Tests: `parse-gladia.test.ts` (5 sentiments + emotion passthrough),
`insights-aggregate.test.ts` (grouping + occurrences + pct), update
`insights-reconcile.test.ts` + `insights-schemas.test.ts`. `dev`: a Gladia meeting
shows the dashboard (no transcript) with speaker %, all sentiments + emotions incl.
mixed/unknown, expandable clickable occurrences, and top entities.
