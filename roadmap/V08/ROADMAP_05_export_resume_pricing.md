# ROADMAP_05 — Export + boot-resume + pricing

Robustness + completeness around the insights data.

## Boot-resume of pending insights

If the app closes during the (usually brief) post-processing window, the WS
`post_final_transcript` is lost. Recover via the GET endpoint:

- `scribe/src/main/index.ts`: after `registerIpcHandlers()` (`:114`), kick a
  best-effort resume: `getPendingInsights()` → for each row, if a Gladia key is
  set, `fetchGladiaResults(sessionId, key)` (ROADMAP_02 `gladia-results.ts`) for
  each `session_ids_json` id, merge, reconcile "Me" via `getTranscript`, then
  `saveInsights` (or `setInsightsError` if the job is gone/404). Run detached;
  never block boot.
- Ensure `will-quit` (`:133`) drains the `enriching` set (ROADMAP_03) so a clean
  quit doesn't strand sockets.

## Export — `db/export.ts` + `ipc/export.ts` + `shared/ipc-contract.ts`

- **Backup bundle v3.** Bump `BackupBundleSchema.version` union (`:586`) to
  include `3`; add an optional `insights` field to `BackupMeetingSchema`
  (defaulting to `null` so v1/v2 bundles still validate) and a `sttProvider`
  field (default `null`). `db/export.ts:159` writes `version: 3`.
- **Export:** `rowToMeeting` includes `meeting_insights.insights_json` (parsed)
  + `meetings.stt_provider`.
- **Restore:** `restoreFromBackup` (`db/export.ts:180-267`) inserts the
  `meeting_insights` row (status `'ready'` when present) and sets
  `meetings.stt_provider`. Keep it tolerant of absent insights (older bundles).
- **Markdown export (guide §13.4):** append an "Insights" section to the
  per-meeting Markdown (`ipc/export.ts` `meetingToMarkdown`, `:62-106`):
  speaker-attributed enriched transcript with entities + sentiment, when
  insights exist. No-op when absent.

## Pricing — `scribe/src/shared/pricing.ts` (canonical)

- Add a Gladia constant, e.g. `gladiaSolariaPerMinute` (transcription minute;
  note in a comment that NER/sentiment are separately billed add-ons and are
  *approximated*, not itemized — guide §12).
- **Provider-aware cost.** `estimateCost` (`:53`) gains an optional
  `sttProvider?: 'deepgram' | 'gladia' | 'whisper'`: Gladia → minutes ×
  `gladiaSolariaPerMinute` (× channels); Whisper → 0 (local); Deepgram →
  existing path. `getUsageTotals` (`db/meetings.ts:171`) reads each meeting's
  `stt_provider` and prices accordingly, so the Settings → Usage & Cost figure
  stays correct across mixed-provider histories. `formatCost`/`formatAudioDuration`
  unchanged. (`main/enhancer/pricing.ts` re-exports `shared/pricing.ts` — edit
  the shared file only.)

## Verification

- Export a Gladia meeting → JSON bundle carries `insights` + `sttProvider`;
  Markdown carries the enriched section. Restore into a wiped DB → insights +
  provider survive; the Insights view renders.
- Usage & Cost: a Gladia meeting and a Deepgram meeting show distinct,
  provider-correct cost contributions.
- Force-quit during post-processing (dev: throw before finalize), relaunch →
  boot-resume fills the insights from the GET endpoint.
