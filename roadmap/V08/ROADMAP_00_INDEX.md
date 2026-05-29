# ROADMAP_00_INDEX.md

> **Status: shipped in v0.8.0.** All six blocks below are merged to `main`;
> see `README.md` + `SHIPPED_HISTORY.md` for the shipped summary. V08 adds
> **Gladia** as a third streaming-STT provider alongside Deepgram (default) and
> local Whisper, *keeping both intact*. The full implementation guide this roadmap is
> derived from is `gladia-live-stt-implementation-guide.md` in this
> folder; where the guide and the real `@gladiaio/sdk@1.0.4` API
> disagree, **the SDK wins** and the deviations are documented in
> `ROADMAP_02`.

The **V08 backlog — Gladia live STT + post-call audio intelligence.**
Gladia's live STT (`solaria-1`) is added as the maximal-fidelity cloud
option: besides streaming transcripts it produces **diarization, Named
Entity Recognition (NER), and sentiment**, none of which Nexus surfaces
today. V08 wires Gladia behind the existing `TranscriptionSession`
interface and adds a post-call **Insights** layer (storage + UI) for the
intelligence.

### What the real SDK changed vs the guide (read before planning)

The guide assumed a raw two-step REST→WebSocket flow with a top-level
`diarization/named_entity_recognition/sentiment_analysis: true` config
and a separate `GET /v2/live/:id` fetch for results. The installed
`@gladiaio/sdk@1.0.4` is different and *simpler*:

- `new GladiaClient({ apiKey }).liveV2().startSession(config)` returns a
  `LiveV2Session` **synchronously** (init + WS handled internally). Events:
  `started | connecting | connected | ending | ended | message | error`.
  Methods: `sendAudio() | stopRecording() | endSession() | getSessionId()`.
- **The SDK reconnects internally** (`wsRetry`, unlimited by default), so
  Gladia needs no hand-rolled backoff/buffer (unlike `DeepgramSession`).
- **NER + sentiment are `realtime_processing` features** delivered as WS
  `message` events (`named_entity_recognition`, `sentiment_analysis`,
  each keyed by `utterance_id`), and a comprehensive `post_final_transcript`
  message carries the full `LiveV2TranscriptionResult` at session end.
  **No separate `GET /v2/live/:id` is needed** for the normal path — the
  GET-based path is kept only for boot-resume (app closed mid-processing).
- **No top-level `diarization` toggle** exists in the live-v2 config
  types; `utterance.speaker` is populated when the model can. NER/sentiment
  results carry **no confidence** field. Transcription language codes are
  **ISO-639-1** (`pt`, `en`, `es`…), so `bcp47` must be mapped (`pt-PT`→`pt`).

### Decisions baked into this roadmap (user-approved)

1. **Use `@gladiaio/sdk`** (added: `@gladiaio/sdk@^1.0.4` + peer
   `eventemitter3`; `ws` peer already present).
2. Surface insights **both** ways — weave NER/sentiment into the live
   transcript panel **and** a dedicated post-call **Insights** view.
3. **Seamless ~3-hour session handoff** (restart the WS near 2.5h with
   continuous timestamps; merge results across sub-session ids).

### §1 invariants hold across every block

No audio on disk (§1.1 — frames go from `pushAudio` straight to the SDK
socket; the post-final result is server-side, never local audio), keys
stay main-side and unlogged (§1.2 — `GladiaSession` lives in main; never
log the tokenized `wss://…?token=` URL), renderer stays sandboxed (§1.3 —
insights cross IPC only as Zod-validated payloads), no meeting-platform
integration (§1.4), user notes sacred (§1.5 — insights are a *separate*
table + view; never touch `notes`/`enhanced_json` and are never fed to the
enhancer), strict-JSON enhancer contract unchanged (§1.6), language
auto-detect preserved (§1.7 — Gladia language is mapped from the existing
`LanguageSetting`; the guide's `["en"]` default is rejected).

## The blocks

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | Data + settings plumbing | Migration **v14** (`meeting_insights` table + `meetings.stt_provider`); `db/insights.ts`; secrets `getGladiaKey/setGladiaKey`; extend `transcription_provider` → `'gladia'` everywhere; new shared `MeetingInsights` types + IPC schemas/channels (`meetings:getInsights`, `transcription:insightsStatus`). | DB + shared + secrets + ipc-contract |
| 02 | GladiaSession + pure parser | `session.ts` gains optional `onInsights?`; new `gladia.ts` (SDK-isolated, language mapping, handoff, retention-after-stop); pure `parse-gladia.ts` (accumulated SDK messages → normalized insights, sub-session merge with offsets); `gladia-results.ts` (GET fallback for resume); factory branch in `transcription/index.ts`. | Main transcription |
| 03 | IPC enrichment lifecycle | `ipc/transcription.ts`: provider snapshot, captured `meetingId`/`target`, `enriching` Set retention after stop, `onInsights` reconciles "Me" via `getTranscript` (energy timeline is gone), `dispose` drains; provider-aware usage. `meetings` IPC + preload for `getInsights` + status push. | Main IPC + preload |
| 04 | Renderer — settings + Insights + weave | Settings provider toggle + Gladia `KeyRow` + provider-aware privacy copy; `App.tsx` `'insights'` view + provider-aware key guard + surfaced start error; new `features/insights/` (view, summary, hook, merge helper); `TranscriptPanel` NER underline + sentiment glyph; CSS tokens. | Renderer |
| 05 | Export + boot-resume + pricing | Boot resume of pending insights via `gladia-results.ts`; export bundle **v3** + Markdown enrichment + restore; provider-aware `estimateCost`/`getUsageTotals` + Gladia per-minute constant. | Main + shared |
| 06 | Tests + green | Unit tests: `parse-gladia` (incl. multi-sub-session merge + offsets), `insights-merge`, migration v14 on a populated DB, new Zod schemas, provider-aware cost, gladia config builder. `typecheck/lint/test` green. | Tests |

## Dependencies

```
01 data/settings ──► everything (types, channels, migration, secrets).

02 GladiaSession ──► consumes 01 types; emits normalized ProviderInsights.
   SDK surface is confined to gladia.ts + parse-gladia.ts (+ gladia-results.ts).

03 IPC lifecycle ──► consumes 02 (onInsights) + 01 (db/insights, channels).
   The retention-after-stop + handoff-offset logic lives here + in 02.

04 renderer ──► consumes 01 (types/channels) + 03 (getInsights/status push).

05 export/resume/pricing ──► consumes 01 (stt_provider, insights table) + 02
   (gladia-results for resume).

06 tests ──► cover 01,02,05 pure pieces + migration.

Migration v14 (additive, NULLable; CLAUDE.md §7 — no DROP/recreate):
  CREATE TABLE meeting_insights ( meeting_id PK → meetings(id) ON DELETE CASCADE,
    provider TEXT, status TEXT, insights_json TEXT, session_ids_json TEXT,
    error TEXT, updated_at INTEGER );
  ALTER TABLE meetings ADD COLUMN stt_provider TEXT;   -- NULL = legacy/deepgram
```

## Suggested order

1. **01** — smallest blast radius; unblocks everything (types, channels,
   migration, secrets). No behaviour change yet.
2. **02** — the SDK-facing core. Land the pure `parse-gladia.ts` with tests
   first so the SDK message → normalized mapping is pinned before wiring.
3. **03** — the highest-risk file (`ipc/transcription.ts` enrichment
   lifecycle). Retention-after-stop + "Me" reconcile via `getTranscript`.
4. **04** — renderer. Largest user-visible surface; needs a live call.
5. **05** — export/resume/pricing. Lands after the storage shape is stable.
6. **06** — tests run throughout; this block is the "everything green" gate.

## Cross-cutting notes (hold across every block)

- **SDK surface is contained to two files.** Only `gladia.ts` and
  `parse-gladia.ts` import `@gladiaio/sdk` types. Every other layer consumes
  the app's normalized `TranscriptionSession` / `MeetingInsights` types, so
  an SDK upgrade can't ripple past those two files. Pin `@gladiaio/sdk` and
  `eventemitter3` versions (CLAUDE.md §2/§10).
- **Gladia uses the existing audio pipeline unchanged.** The worklet
  already emits 16 kHz / 16-bit / mono PCM (and a 2-channel best-quality
  mode); `pushAudio(Int16Array)` → `sendAudio(Buffer)` is the only contact
  point. No renderer audio changes.
- **"Me" stays energy-based.** Gladia mono diarization yields `Speaker N`;
  the existing segment-level `attributeMe` (`ipc/transcription.ts`
  `attributeSpeaker`) recovers "Me" exactly as for Deepgram. Post-call
  insights reconcile "Me"/speaker by **time-overlap against the persisted
  segments** (the energy timeline is cleared on stop).
- **One additive migration (v14).** No DROP/recreate; existing meetings stay
  readable and simply show no Insights affordance.
- **Insights are not searchable in V08** (`search_fts` untouched) and the
  live transcript is **not** re-written from Gladia's post-call diarization
  — live segments + energy "Me" remain authoritative; Gladia diarization
  drives the Insights view + the weave overlay only. Both are explicit
  non-goals.
- **Type/lint/test/build green at every commit** (CLAUDE.md §10/§11), via
  `corepack pnpm <cmd>` from `scribe/`. Verify in a `corepack pnpm dev` run
  with a real Gladia key before declaring done.

## How to use a block with Claude Code

Same discipline as V07x: read the block file plus the relevant code,
propose how the change fits established patterns before writing, ship as its
own commit to `main` (memory `commit-to-main`), hold the §1 invariants, keep
`corepack pnpm typecheck/lint/test/build` green. Block 02 needs the pure
parser pinned by tests; block 03 needs a live Gladia call to confirm the
post-call enrichment lands and "Me" reconciles; block 04 needs a live call
to confirm the Insights view + inline weave render.
