# ROADMAP_00_INDEX.md

The **V05 backlog — Transcription Quality & Cost.** v1→v4 shipped capture,
transcription, enhancement, organization, and the UI/UX rebrand. V05 is the first
phase that goes back into the **speech-to-text core** to fix two real problems seen
in production use:

1. **Quality.** In a 3-person meeting the two *remote* speakers were merged into one,
   words were mis-transcribed, and foreign-language words leaked into a single-language
   meeting.
2. **Cost.** Deepgram billed ~$0.26 for 22 minutes (~$0.0118/min) — the 2-channel
   capture is billed *per channel*, doubling the bill.

Like v03/v04, each block has its own file and can be specced into Claude Code on its
own. This index explains the grouping, the dependencies, and the suggested order.

> **These blocks touch the §6 audio path and the §8 LLM-adjacent transcription
> config — the highest-care area of the app.** Hold the §1 invariants exactly:
> **§1.1** no audio is ever written to disk (the mic-energy signal block 02 adds is a
> per-frame *scalar* RMS level, never audio bytes); **§1.2** the Deepgram key stays in
> main; **§1.3** the renderer stays untrusted — any new IPC (energy side-channel, model
> setting) goes through the shared contract with a Zod schema; **§1.7** never default to
> English — these blocks *improve* non-English handling. The transcription provider
> interface (`TranscriptionSession`) stays swappable.

## The blocks

| # | Block | What it is | Type |
|---|---|---|---|
| 01 | Diarization + Language Accuracy | Turn on real speaker diarization; make single-language meetings use the dedicated model | Quality (shipped in this phase) |
| 02 | Single-Channel Cost Reduction | Send one mono channel + streaming diarization; derive "Me" from the mic-energy signal — ~halves the bill | Cost (audio-path; needs live validation) |
| 03 | Hybrid & Fully-Offline Transcription | Local-mic + cloud-system hybrid (fallback for 02); fully offline WhisperX-style as the long-term $0 endgame | Feature (phased / deferred) |

## Dependencies

```
v1–v4 (shipped)
  └─ 01 Diarization + language ──► fixes the merged-speaker + wrong-language bugs.
        Pure Deepgram-param + config change. No audio-graph change. Low risk.
        │
        └─► 02 Single-channel cost ── builds on 01's diarization; changes the
              capture worklet to mono + adds the mic-energy "Me" mapping. Halves
              cost. MUST be validated on a live ≥3-person call (§6, §9).
                 │
                 └─► 03 Hybrid / offline ── 03a (hybrid local-mic) is the documented
                       fallback if 02's energy heuristic proves unreliable; 03b
                       (offline WhisperX) is deferred until a no-cloud mode is wanted.
```

## Suggested order

1. **01 Diarization + language** first — it is the precise fix for the reported quality
   bugs, is unit-testable, and does **not** touch the capture graph. Safe to ship
   immediately.
2. **02 Single-channel cost** next — the cost win. It rewrites the capture worklet to a
   single mono channel and trades the deterministic mic=Me / system=Them split for an
   energy-based heuristic, so it can only be proven on a real multi-person call. Land it
   on its own branch and validate live before merge.
3. **03 Hybrid / offline** only if needed: 03a if 02's heuristic underperforms in real
   meetings; 03b if/when a fully-private no-cloud mode is prioritized.

## Cross-cutting notes (hold across every block)

- **Stay on nova-3 — do not adopt Deepgram Flux.** Flux is a *voice-agent* model on a
  separate `/v2/listen` endpoint; Deepgram's own comparison marks **meeting
  transcription, speaker diarization, word-level timing, and smart formatting as
  unavailable** on it, and it costs *more* ($0.0065–0.0078/min vs nova-3's
  $0.0048–0.0058/min). It would remove the very diarization this phase depends on and
  raise cost. Revisit only if the product ever pivots to a live conversational agent.
- **Per-channel billing is the cost lever.** Deepgram bills per channel; the 2-channel
  capture doubles the bill. Block 02's whole purpose is to drop to one billed channel.
- **`multichannel` ≠ diarization.** Splitting audio channels is not splitting speakers.
  Two people on the system/loopback channel can *only* be separated by `diarize=true`
  (block 01). This was the root cause of the merged-speaker bug.
- **No audio to disk (§1.1).** Block 02's "Me"-mapping uses per-frame RMS *levels*
  (scalars), correlated with segment time windows. No audio buffer is ever retained.
- **Migrations only (§7).** If block 02 persists a per-meeting billed-channel count for
  accurate cost history, it ships as an additive migration — never recreate tables.

## How to use a block with Claude Code

Feed the block file plus the codebase. Same discipline as v03/v04: read the existing
code, propose the fit before writing, ship as its own branch, hold the §1 invariants,
and keep `pnpm typecheck/lint/test/build` green. For block 02, **manually validate a
live ≥3-person call** (per-channel VU meters + the live transcript) before merge — §9
is explicit that automated tests cannot prove loopback capture.
