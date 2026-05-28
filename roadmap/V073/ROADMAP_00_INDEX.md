# ROADMAP_00_INDEX.md

> **Status: shipped in v0.7.3.** All three blocks below are merged to
> `main`. See `README.md` and `CLAUDE.md` for the shipped summary; these
> per-block files now serve as historical reference for *what* was built
> and *why*.

The **V073 backlog — Transcription quality & bullet-proof Windows audio
capture.** V05/V062 brought single-channel capture + per-word "Me"
attribution to halve Deepgram cost while keeping the user's voice distinct
from remote speakers. In real use two classes of bugs still bit users on
varied Windows 10/11 machines:

1. **Diarization quality.** "Me" still fragmented and stole turns from
   remote speakers — especially when the user listened on **laptop
   speakers**, where their voice leaked into the mic and biased the
   per-word energy heuristic. Remote-side, Deepgram nova-3 doesn't
   preserve a stable speaker identity across pauses / language shifts, so
   one monologue arrives split across several speaker IDs.
2. **Capture reliability.** On some machines the mic wasn't captured (a
   stored `{exact: deviceId}` was stale after a reboot / Bluetooth
   reconnect), and on others the system loopback was silent (empty
   `desktopCapturer` source list, muted loopback track, or a non-16 kHz
   endpoint that the AudioContext silently resampled wrong). All of these
   failed *silently* until the meeting ended on an empty transcript.

V073 fixes both: it makes "Me" attribution robust to speaker-bleed via a
cross-correlation bleed score, lets the user override the regime via a
single Settings toggle, and adds a preflight + fallback chain so capture
cannot fail silently on any supported hardware. The §1 invariants hold —
audio still never touches disk (§1.1), keys stay main-side (§1.2), the
renderer stays sandboxed (§1.3), no meeting-platform integrations (§1.4),
notes are sacred (§1.5), the JSON contract is unchanged (§1.6), and we
still auto-detect language (§1.7).

> **Hold the §1 invariants.** Block 01 only touches capture orchestration
> (no new persistence, no audio bytes leaving RAM); block 02 only changes
> a pure math function in `me-attribution.ts`; block 03 only changes how
> remote-segment fragments are grouped on the way out and reuses the
> existing speakers IPC for manual renames. No schema migration, no IPC
> contract churn beyond two push channels + one settings key.

## The blocks

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | Bullet-proof Windows audio capture | Layered mic + loopback fallback chains, sample-rate negotiation, in-meeting silence watchdog, capture diagnostics surface | Main + renderer audio |
| 02 | Bleed-aware "Me" attribution | Cross-correlation bleed score → adaptive dominance / micFloor; 1-word median filter; explicit headphones/speakers/auto mode toggle | Main transcription + Settings UI |
| 03 | Auto-merge adjacent remote fragments | Post-process `groupAttributedWords` output: merge consecutive remote segments differing only by Deepgram speaker ID when gap < 800 ms, similar word rate, and ≥3 words each | Main transcription |

## Dependencies

```
Independent unless noted:

01 Capture reliability ── independent; touches loopback.ts, capture.ts,
   pcm-framer.worklet.js, ipc/transcription.ts (watchdog), one new push
   channel pair (audio:loopbackDenied + transcription:warning).

02 Bleed-aware Me ──────► (consumes the same energy timeline as) 03 auto-merge.
   Block 02 must keep `attributeWords` returning the same `AttributedWord[]`
   shape since `groupAttributedWords` (and therefore 03) sits downstream.

03 Auto-merge ──────────► (runs inside) `groupAttributedWords` after 02's
   per-word attribution + median filter, so any change to that function's
   return type ripples here. The merge is conservative (≥3 words per
   fragment) so synthetic unit tests with 1-word fragments are unaffected.

Settings UI (the Listening-on toggle) is part of block 02; the Settings →
Audio section already existed, V073 just adds a row.
```

## Suggested order

1. **01 Bullet-proof capture** — biggest user impact and biggest blast
   radius, so land first and verify on the diverse machines that
   reported problems before touching anything else.
2. **02 Bleed-aware Me** — pure math change + a Settings toggle, no
   capture dependency. Safer to land after 01 because the existing
   `me-attribution-*.test.ts` suites pin behaviour that block 02 extends.
3. **03 Auto-merge** — runs inside `groupAttributedWords` so it's the
   smallest change of the three; lands last so any regression caught in
   manual verification of 01/02 doesn't get blamed on this one.

## Cross-cutting notes (hold across every block)

- **No new schema.** V073 ships zero DB migrations. The new
  `audio_capture_mode` setting goes in the existing KV `settings` table.
  Manual speaker merging reuses the existing `speakers.set` IPC (rename
  two Deepgram speaker labels to the same display name → they group as
  one person in the transcript view), so no `speaker_labels` table is
  needed for v0.7.3. If multi-meeting auto-merge ever needs to persist
  Deepgram-speaker IDs per segment, that's a future block.
- **IPC churn is small.** Two new push channels (`audio:loopbackDenied`,
  `transcription:warning`), one new request channel
  (`settings:setAudioCaptureMode`). Every channel is declared in
  `scribe/src/shared/ipc-contract.ts` with a Zod schema (§4).
- **Audio bytes still don't leave RAM.** The capture probe runs for
  ~1.5 s and discards everything; the in-worklet resampler keeps one
  source-sample of carry between quanta; the energy timeline is scalar
  RMS only (§1.1). No new disk writes anywhere.
- **Settings → Audio is the one UX surface.** A new "Listening on" row
  (Auto / Headphones / Speakers) lives next to the existing mic + language
  pickers. Block 01.4 (a pre-flight Start modal) and block 01.7 (a new
  onboarding "Set up audio" step) from the original plan were deferred —
  the watchdog + `CaptureProbe` diagnostic + Settings panel already cover
  the silent-failure modes, and the `runCaptureProbe()` helper is exported
  for a future block.
- **No new dependencies.** Everything ships against the V072 surface
  area; no new pnpm deps.
- **Type/lint/test/build green at every commit** per CLAUDE.md §10/§11.
  The new `me-attribution-bleed.test.ts` (9 tests) and the existing
  `me-attribution.test.ts` + `me-attribution-words.test.ts` suites all
  stay green; full suite is 256 / 256.

## How to use a block with Claude Code

Feed the block file plus the codebase. Same discipline as V06/V07/V072:
read the existing code, propose the fit before writing, ship as its own
commit to `main` (per CLAUDE.md §10 + memory `commit-to-main`), hold the
§1 invariants, and keep `corepack pnpm typecheck/lint/test/build` green.
Verify each block in a `corepack pnpm dev` run before declaring done —
capture changes (block 01) in particular need at least one manual probe
on hardware that previously failed (Bluetooth headset reconnect, laptop
without an HDMI-or-Stereo-Mix loopback path, a non-16 kHz default
endpoint).
