# ROADMAP_00_INDEX.md

> **Status: planned.** Four blocks below are the V075 plan; none have
> shipped yet. Order matters (see "Suggested order"). On ship, this header
> moves to "shipped in v0.7.5" and each block's "What changed" becomes
> the historical reference for future readers.

The **V075 backlog — Diarization & transcript fidelity (Deepgram
May-2026 features).** Deepgram refreshed their diarization + transcript
features in May 2026: a v2 batch diarizer (pre-recorded only; streaming
stays on v1), `filler_words` to preserve the seven canonical fillers,
`paragraphs` for diarization-aware paragraph breaks, and a refresher on
combining `multichannel=true` + `diarize=true` for the exact "one clean
mic channel + one shared system channel" topology Nexus uses.

Two classes of user-visible quality wins are still on the table after V073:

1. **Remote-speaker fragmentation.** V073 ROADMAP_03's auto-merge
   collapses adjacent `Speaker N` fragments using a word-rate +
   800 ms-gap heuristic. It misses fragments separated by a longer pause,
   a code-switch, or any case where the word-rate check is too noisy.
   Deepgram's new `paragraphs` field gives us a *second*
   diarization-aware boundary signal (paragraph breaks are explicitly
   influenced by speaker changes per Deepgram's docs) that we can use to
   merge fragments inside the same paragraph unconditionally.
2. **Own-voice bleed.** V073 ROADMAP_02 made the per-word Me heuristic
   adaptive to mic/system cross-correlation, but the underlying mono
   capture still mixes the user's voice into the same stream as the
   remote audio. The cleanest fix — the one Deepgram itself recommends
   for our shape on `docs/multichannel-vs-diarization` — is to keep mic
   and system as separate channels and let Deepgram diarize each one
   independently. The legacy 2-channel code path already exists in
   `parse.ts` and `deepgram.ts`; V05 mono gated it behind
   `channels === 1` rather than deleting it. V075 surfaces it as an
   opt-in **Best-quality** capture mode at ~2× Deepgram cost.

Plus one transcript-fidelity win: filler words. Today Deepgram strips
`uh` and `um` by default. V075 turns `filler_words=true` on, tags filler
tokens so they bypass the per-word Me-attribution noise floor (which
they were corrupting), and renders them subdued so transcript content
stays the visual focus.

§1 invariants hold across every block — no audio on disk (§1.1, even in
stereo mode), keys stay main-side (§1.2), renderer stays sandboxed
(§1.3), no meeting-platform integrations (§1.4), user notes sacred
(§1.5), strict-JSON enhancer contract unchanged (§1.6),
language auto-detect preserved (§1.7 — `filler_words` is English-only
and gates on `language=en` or auto+detected=en).

> **Hold the §1 invariants.** Block 01 only adds a query parameter and
> a parser field; block 02 only changes a pure grouping function in
> `me-attribution.ts`; block 03 adds an additive KV setting + IPC
> channel + parser tag + renderer span; block 04 surfaces an existing
> code path behind a new KV setting. One additive migration (v13)
> shared by blocks 02 + 03 for two nullable columns; three new IPC
> channels; no schema churn beyond that.

## The blocks

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | `paragraphs=true` + parse layer | Add `paragraphs=true` to the Deepgram query; parse the paragraphs block; tag each `DeepgramWordView` with `paragraphIndex`. Pin the full query-param set against silent drift. | Main transcription |
| 02 | Paragraph-aware grouping & merging | Use `paragraphIndex` in `groupAttributedWords` + `autoMergeAdjacentSpeakers`: adjacent remote fragments in the same paragraph merge unconditionally; long single-speaker runs get internal paragraph breaks in the renderer. | Main transcription + renderer + migration v13 |
| 03 | Filler words capture & UX | `filler_words=true` (English-only); KV setting `transcript_include_fillers` (default on); canonical filler detection; short isolated fillers inherit neighbour `isMe`; subdued rendering; Settings toggle. | Main transcription + Settings UI + migration v13 |
| 04 | Stereo-mic split capture mode | Opt-in **Best quality** capture: 2-channel (mic ch0 always "Me", system ch1 Deepgram-diarized for remotes), `multichannel=true` + `diarize=true` per Deepgram's combine-both guidance. ~2× billed channels; eliminates bleed at source. | Renderer audio + Settings UI |

## Dependencies

```
01 paragraphs param ──────► (provides paragraphIndex to) 02 grouping.
   No DB or IPC churn; pure additive parser change. Tests pin the
   query string so future param drift surfaces immediately.

02 paragraph-aware grouping ──────► (consumes 01) ──┐
                                                    │ share
03 filler words ────────────────────────────────────┘ migration v13
                                                      (paragraph_breaks_json,
                                                       word_spans_json)

04 stereo capture mode ── independent; re-enables a pre-V05 path.
   Coexists with blocks 01–03 (paragraphs still flows, fillers still
   gate on language). Disables the V073 `audio_capture_mode` row in
   Settings (stereo eliminates bleed at source, so the bleed-aware
   constants are bypassed; the row becomes a no-op).

Migration v13 ─ shared by 02 + 03, both columns NULLable:
  ALTER TABLE transcript_segments ADD COLUMN paragraph_breaks_json TEXT NULL;
  ALTER TABLE transcript_segments ADD COLUMN word_spans_json       TEXT NULL;
```

## Suggested order

1. **01 paragraphs param** — smallest blast radius (one new query param,
   one new optional field on `DeepgramWordView`). Lands first to unblock
   02 and to get the new test pin (`deepgram-query.test.ts`) in early.
2. **02 paragraph-aware grouping** — biggest diarization-quality win.
   Sits inside `groupAttributedWords` + `autoMergeAdjacentSpeakers`
   (V073 ROADMAP_03 territory), so the existing
   `me-attribution-words.test.ts` is the regression suite to extend.
3. **03 filler words** — additive UX block. Lands after 02 so the
   wordSpans column in migration v13 ships in one commit (blocks 02 + 03
   share it).
4. **04 stereo capture mode** — fully independent. Lands last because
   it's the largest user-visible change, the cost story needs Settings →
   Usage & Cost validation, and re-enabling a pre-V05 code path needs a
   real call on hardware to verify nothing rotted.

## Cross-cutting notes (hold across every block)

- **Streaming is pinned to v1.** Deepgram's `diarize_model` parameter is
  pre-recorded only — sending it on streaming returns HTTP 400. V075
  documents this in a comment in `buildDeepgramQuery` so a future
  contributor doesn't try to "upgrade" us into the 400 response. When
  Deepgram adds `diarize_model` to streaming, only `deepgram.ts` needs
  to flip — the heuristics layer is happy to be replaced by a better
  upstream signal.
- **Punctuation + smart_format stay on as invariants.** Both already
  set (`deepgram.ts:54-55`); V075 documents *why* in the same comment
  block: the enhancer prompt (§1.6) assumes punctuated input and
  `smart_format` is what makes paragraph breaks meaningful in EN/ES.
  Neither becomes user-toggleable.
- **No `utterances` or `endpointing` tuning.** Both were considered;
  both would reshape the finals cadence and force a re-tune of V062 /
  V073 constants. V075 stays "paragraphs only" on the Deepgram param
  side per user-confirmed defaults.
- **One additive migration (v13).** Two nullable TEXT columns on
  `transcript_segments`. No DROP/recreate (CLAUDE.md §7). Existing
  meetings stay readable; the renderer treats NULL as "no breaks
  recorded".
- **Two new KV settings, no migration.** `transcript_include_fillers`
  (default `true`) and `capture_quality` (default `'cost-saver'`).
  Both go in the existing KV `settings` table.
- **Three new IPC channels.** `settings:setTranscriptIncludeFillers`,
  `settings:setCaptureQuality`, and (read-side) the existing
  `settings:get` returns both new keys. All declared in
  `scribe/src/shared/ipc-contract.ts` with Zod schemas (§4).
- **Type/lint/test/build green at every commit** per CLAUDE.md §10/§11.
  New test files: `deepgram-query.test.ts`,
  `parse-deepgram-paragraphs.test.ts` (or extension of an existing
  file — verify before naming). The full suite stays green.

## How to use a block with Claude Code

Same discipline as V072/V073: read the block file plus the relevant code,
propose how the change fits the established patterns before writing, ship
as its own commit to `main` (CLAUDE.md §10 + memory `commit-to-main`),
hold the §1 invariants, keep `corepack pnpm typecheck/lint/test/build`
green. Verify each block in a `corepack pnpm dev` run before declaring
done — block 02 in particular needs a live call with multiple remote
speakers to confirm same-paragraph fragments collapse; block 04 needs a
live call on laptop speakers to confirm "Me" misattribution drops to
zero.
