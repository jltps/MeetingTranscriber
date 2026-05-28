# ROADMAP_00_INDEX.md

> **Status: SHIPPED in v0.6.2.** Block 01 landed in commit history on `main`; see
> `roadmap/V062/ROADMAP_01_per_word_me_attribution.md` for the spec and the
> verification recorded in the commit message.

The **V062 backlog — Per-Word "Me" Attribution.** V05 ROADMAP_02 moved capture to a
single mono channel (~halving Deepgram's per-channel bill) and recovered the local
user from a per-frame mic-vs-system energy correlation
(`scribe/src/main/transcription/me-attribution.ts`). That decision is currently made
**per segment**: each `TranscriptSegment` Deepgram emits is averaged across its time
window and either flipped to `"Me"` or left as `"Speaker N"`.

In live use this misbehaves in one specific way: **the user's own voice gets
scattered across multiple Deepgram speaker IDs** ("Speaker 3", "Speaker 4",
"Speaker 5", …) instead of consistently appearing as `"Me"`. Deepgram's diarizer
does not preserve a stable speaker identity across a session — it readily fragments
one physical voice into several IDs after pauses, language shifts, or audio-quality
variations. Per-segment attribution requires *each* fragment to independently clear
the dominance test, and long mixed-speaker segments average mic + sys across the
whole window — burying the user's actual mic-dominance signal.

V062 is one block: **move attribution to the word level**, then **regroup words by
attribution first and Deepgram speaker second**. The same energy timeline drives a
much tighter (~word-length) dominance query, and Me-words coalesce into one `"Me"`
run regardless of how many speaker IDs Deepgram scattered them across. Remote
speakers continue to be separated by Deepgram's diarization as today.

> **Hold the §1 invariants exactly.** §1.1: the energy timeline still carries
> scalar RMS only — no audio bytes, ever. §1.2: no API keys touched; no new IPC
> shapes — `transcriptionPushFrame` and `transcriptionSegment` keep their current
> payloads. §1.5: the user's notes are untouched. §1.6/§1.7: enhancement and
> language paths are not modified. No DB migration is needed — the on-wire
> `TranscriptSegment` shape is unchanged; only how segments are produced changes.

## The block

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | Per-Word "Me" Attribution | Replace per-segment energy classification with per-word, then regroup by `(attribution, deepgramSpeaker)` so own-voice coalesces into `"Me"` even when Deepgram fragments it across speaker IDs | Engine (transcription pipeline) |

## Dependencies

```
V05 ROADMAP_02 (shipped) ── single-channel mono + segment-level mic-energy heuristic
   └─► V062 01 ── per-word energy classification + (attribution, speaker) regrouping
```

## Suggested order

1. **01 Per-Word Me Attribution** — the only block.

## Cross-cutting notes

- **Defaults stay conservative.** `micFloor` and `dominance` keep their V05 values
  (`0.01` and `1.5`). The per-word path proposes a tighter `windowPadMs` default
  (`60 ms` vs the segment-level `150 ms`) because word time windows are short;
  document the rationale in code.
- **Interim results stay on today's path.** Per-word attribution applies to
  `is_final` results only. Interim text continues to use Deepgram's speaker label
  for live display. Final segments remain the authoritative ones persisted to DB.
- **Legacy 2-channel untouched.** The early-return `audioChannels !== 1` branch in
  `scribe/src/main/ipc/transcription.ts` ensures the multichannel path is never
  invoked through the new logic.
- **Rollback is one revert.** All behavior changes are gated by the single-channel
  branch in `ipc/transcription.ts`; reverting that file restores the V05 segment-
  level path exactly.
- **Explicitly deferred to a future block (if needed).** Heuristic tuning
  (`dominance`/`micFloor`/peak-vs-mean RMS), cross-segment hysteresis, exposing
  thresholds in Settings, diagnostic per-segment energy logging in the DB, and an
  optional 2-channel high-accuracy mode (~2× Deepgram cost) toggled in Settings.
  These were considered during V062 design and chosen against to keep this block
  surgical. Revisit if per-word attribution alone proves insufficient — especially
  for open-speaker setups with system-audio bleed into the mic.

## How to use this block with Claude Code

Feed the block file plus the codebase. Same discipline as V05/V06: read the
existing code, propose the fit before writing, ship as its own commit (directly to
`main` per CLAUDE.md §10), hold the §1 invariants, and keep
`corepack pnpm typecheck/lint/test/build` green. Validate manually with one
headphones run and one open-speaker run before declaring the block done; record
both in the commit message.
