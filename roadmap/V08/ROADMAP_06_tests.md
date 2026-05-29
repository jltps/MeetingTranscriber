# ROADMAP_06 — Tests + everything green

Cover the pieces that break silently (CLAUDE.md §9). Vitest; the live SDK
socket is verified manually (like Deepgram), not in automated tests.

## Unit tests

- **`parse-gladia.test.ts`** — the pure normalizer:
  - `transcript` finals + `named_entity_recognition` + `sentiment_analysis`
    accumulator → normalized utterances; entities substring-matched to offsets;
    sentiment string → label mapping (positive/negative/neutral + emotion).
  - **Two-sub-session merge with a non-zero `baseOffsetMs`** (handoff): times
    offset correctly, ordering by `startMs`, utterance_id collisions namespaced.
  - Missing/empty NER/sentiment → empty arrays, not throws.
  - `toIso639_1` language mapping (`pt-PT`→`pt`, unmappable → omit/auto).
- **`insights-merge.test.ts`** — `mergeInsightsIntoSegments`: time-overlap
  mapping segment↔utterance; entity substring offsets computed against the
  *segment* text; sentiment carried per segment; no false matches.
- **`migrations.test.ts`** (extend) — v14 applies on a DB populated through
  v13: `meeting_insights` exists, `meetings.stt_provider` added, existing
  meetings/segments intact, `user_version === 14`.
- **IPC schema tests** — `MeetingInsightsSchema`, `InsightsStatusSchema`,
  extended `SetKeysSchema` (`gladia`) + `TestProviderSchema` (`gladia`) accept
  valid / reject invalid payloads.
- **`pricing.test.ts`** (extend) — provider-aware `estimateCost`: Gladia vs
  Deepgram vs Whisper(0); `getUsageTotals` partitions a mixed history by
  `stt_provider`.
- **Gladia config builder** — the pure part of `gladia.ts` that maps
  `LanguageSetting` + opts → `LiveV2InitRequest` (auto → empty `languages` +
  `code_switching`; fixed → mapped iso code; realtime_processing flags set).
  Extract it as a pure exported function so it's testable without the SDK.

## Green gate

`corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test` all
green; `corepack pnpm build` compiles. Commit per block to `main`
(memory `commit-to-main`), each commit stating verification + that §1
invariants hold. Do **not** run the release/"build" ship sequence — that's a
separate, user-triggered step.
