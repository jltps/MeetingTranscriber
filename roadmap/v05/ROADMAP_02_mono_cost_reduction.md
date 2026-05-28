# ROADMAP_02 — Single-Channel Cost Reduction

> **Update (V062, shipped).** The energy-based "Me" recovery this block introduced
> was originally applied **per segment**, which scattered the user's own voice
> across multiple Deepgram speaker IDs in real calls. **V062 ROADMAP_01** moved
> attribution to the **word level** and regroups with attribution as the primary
> partition key — Me-words now coalesce into one `"Me"` run regardless of how
> Deepgram fragmented them. The single-mono-channel capture, the energy timeline,
> and the heuristic itself (`micFloor`, `dominance`, `micDominatedWindow`) are
> all unchanged; only the *grain* of the decision moved from segment to word.

Halve the Deepgram bill by sending **one mono channel** instead of two, recovering
speaker separation from streaming **diarization** (block 01) and recovering the "Me"
label from the **mic-energy signal** the capture worklet already computes.

> **Audio-path change — §6 highest care.** This rewrites the capture worklet and trades
> the deterministic mic=Me / system=Them split for an energy-based heuristic. Per §9,
> loopback capture can only be validated manually — **land on its own branch and verify a
> live ≥3-person call before merge.** Block 03a (hybrid) is the documented fallback.

## Why
- Deepgram bills **per channel**. The 2-channel capture doubles every minute. Block 01
  showed `multichannel` does not even help separate the remote speakers — diarization
  does — so the second channel buys only the "Me" label, at 100% extra cost.
- Dropping to one channel ≈ **halves** the per-minute Deepgram cost
  ($0.0118/min → ~$0.0058/min), with no quality loss if "Me" can be recovered.

## Depends on
Block 01 (diarization on). The user's confirmation that **"Me" may be derived
heuristically** rather than staying channel-exact.

## Scope
1. **Mono capture.** `renderer/public/pcm-framer.worklet.js`: emit a single mono channel
   (clamped mic+system mix) instead of interleaved stereo. Keep posting per-frame
   `micLevel`/`sysLevel` RMS — they become the "Me" signal (still scalars; §1.1 holds).
2. **One billed channel.** Pass `channels: 1` from `App.tsx` through
   `TranscriptionStartSchema` to `deepgram.ts`; drop `multichannel`, keep `diarize=true`.
   With one channel, auto mode can use `detect_language=true` (incompatible with
   multichannel, hence the old `multi` workaround) for cleaner single-language detection.
3. **Parser mono mode.** `parse.ts`: add a single-channel diarized mode that runs
   `splitBySpeaker()` over channel 0 for *all* speakers (not the current "channel 0 = Me"
   passthrough).
4. **Mic-energy "Me" mapping.** Forward `micLevel`/`sysLevel` to main as a lightweight
   energy timeline keyed by the cumulative-audio-ms origin main already tracks (a
   non-Zod-validated side channel, like the PCM frame channel — §4). On each final
   diarized segment, compare mean mic vs system energy over its `[startMs,endMs]` window;
   relabel the consistently mic-dominant speaker as **"Me"**, leave the rest "Speaker N".
5. **Cost accounting.** Make `estimateCost()` in `shared/pricing.ts` take the billed
   channel count instead of the hard-coded `× 2`; persist it per meeting if accurate
   historical cost matters (additive migration, §7).

## Key decisions & caveats
- **Headphones vs speakers.** Mixing mic+system into one channel is clean on headphones;
  on open speakers, system audio bleeds into the mic and can confuse both diarization and
  the energy heuristic. Detect/encourage headphones; fall back to block 03a if needed.
- **Heuristic, not biometric.** "Me" mapping is energy-correlation only — no voiceprint.
- **No audio retained.** The energy timeline is RMS scalars per 100 ms frame, dropped
  after mapping. No audio buffer, ever (§1.1).

## Touches
`renderer/public/pcm-framer.worklet.js`, `renderer/audio/capture.ts` (forward levels),
`renderer/app/App.tsx`, `shared/ipc-contract.ts` (channels + energy channel),
`main/ipc/transcription.ts` (energy timeline + relabel), `main/transcription/deepgram.ts`
+ `parse.ts`, `shared/pricing.ts`, and tests.

## Acceptance
- Settings → Usage shows ~half the previous per-minute cost.
- Remote speakers still separated; the local user is still attributed "Me" on a live
  headphone call.
- `pnpm typecheck/lint/test` green **and** a live ≥3-person call validated by hand.

## Out of scope
Hybrid local-mic transcription (block 03a) and fully-offline transcription (block 03b).
