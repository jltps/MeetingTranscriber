# ROADMAP_04 — Stereo-mic split capture mode (opt-in, bullet-proof Me)

## Context

V05 ROADMAP_02 switched Nexus's capture from 2-channel (mic ch0 /
system ch1) to mono (downmixed in the worklet) to halve Deepgram's
per-channel billing. The downside: mic + system audio now share one
stream, so the user's voice and the remote speakers' voices are mixed
together. "Me" attribution became a *heuristic* (V05 → V062 →
V073) — three rounds of refinements to a problem that wouldn't exist
if the two streams stayed separate.

Deepgram's own
[`multichannel-vs-diarization`](https://developers.deepgram.com/docs/multichannel-vs-diarization)
guidance recommends exactly the "combine both" pattern for our shape:

> "Yes, you can use both `multichannel=true` and `diarize=true`
> simultaneously. This provides very specific, useful information
> about the people speaking in multiple audio channels."
>
> "When both features are enabled with separate speakers on separate
> channels, each speaker appears as `speaker: 0` within their
> respective channel."

With mic on ch0 (always the user; trivially `speaker: 0`) and system
on ch1 (Deepgram's diarizer separates the remote speakers, also
starting from `speaker: 0`), "Me" attribution becomes a fact rather
than an estimate. Cost is roughly 2× because Deepgram bills per
channel.

This block surfaces the pre-V05 code path behind an opt-in user
setting rather than deleting V05's mono cost-cut. Cost-saver (mono)
stays the default; users who want fidelity over cost pick Best
quality.

## What changed

### `scribe/src/shared/ipc-contract.ts`

- `CaptureQualitySchema = z.enum(['cost-saver', 'best-quality'])`.
- `SettingsView.captureQuality: CaptureQuality` (defaults to
  `'cost-saver'`).
- `SettingsApi.setCaptureQuality(quality)`.

### `scribe/src/main/db/settings.ts`

- `getCaptureQuality()` / `setCaptureQuality(q)` reading and writing
  the `capture_quality` key in the existing KV `settings` table.
  **No migration.** Defaults to `'cost-saver'`.

### `scribe/src/main/ipc/settings.ts`

- `settings:get` returns `captureQuality`.
- `settings:setCaptureQuality` validates with `CaptureQualitySchema`.

### `scribe/src/main/ipc/transcription.ts`

- On `transcription:start`, snapshots `getCaptureQuality()` into
  session-local state. When `'best-quality'`:
  - Sends `start({ channels: 2, sampleRate })` to the renderer (the
    renderer reads this and configures the worklet accordingly —
    see capture.ts below).
  - The downstream `parseDeepgramMessage` already handles the
    2-channel `channel_index === 0` → "Me" + `channel_index === 1`
    → split-by-speaker case (`parse.ts:64-75`, `splitBySpeaker` at
    `parse.ts:122-139`). No changes needed there.
  - The V062 single-channel finals path (`onWords`) and the V073
    bleed-aware heuristic are bypassed — `attributeWords` is only
    called when `channels === 1`.

### `scribe/src/renderer/audio/capture.ts`

- `acquireMicStream` and the system loopback stream creation are
  unchanged — both already exist as separate `MediaStream`s.
- New `CaptureQuality`-aware code path that wires the two streams
  into the worklet differently:
  - `'cost-saver'` (today's behaviour): downmix in the worklet to
    one mono channel, ship `channels: 1`.
  - `'best-quality'`: leave them as 2 channels (mic = ch0,
    system = ch1), ship `channels: 2` interleaved `Int16Array`.

### `scribe/src/renderer/audio/worklet/pcm-framer.worklet.js`

- The worklet already supports 2-channel interleaved output (it
  existed pre-V05 and was kept alive in the legacy path). V075
  re-validates and, if needed, restores the 2-channel branch
  controlled by a new `processorOptions.outputChannels: 1 | 2`.
- The V073 sample-rate negotiation (`sourceRate` →
  `targetRate=16000` linear decimation) stays in effect for both
  channel counts.

### `scribe/src/main/transcription/deepgram.ts`

- No code change: `buildDeepgramQuery` already sets
  `multichannel: 'true'` when `channels > 1`
  (`deepgram.ts:63`). Block 01's `paragraphs=true` still flows
  alongside; per Deepgram's docs paragraph breaks are influenced
  by channel changes, which is exactly what we want.

### `scribe/src/main/transcription/cost.ts` (or the existing per-meeting
cost module — verify the V05 ROADMAP_02 filename)

- Re-validate that the billed-channels accounting reflects the
  `channels` value at session start. V05 added a column on
  `meetings` to track billed channels for the Usage & Cost panel;
  this block makes sure stereo mode bumps that column to `2` and
  the Settings → Usage & Cost rate reflects the doubled bill.
  Action: read the existing code, write a unit test pinning the
  branch; no code change expected if V05 did it right.

### `scribe/src/renderer/features/settings/SettingsModal.tsx`

- Settings → Audio (V074 tab structure) gets a new **Capture
  quality** row with two segmented buttons:
  - **Cost-saver** (default) — one-line: "Mono capture; uses
    Nexus's bleed-aware Me detection."
  - **Best quality (≈2× Deepgram cost)** — one-line: "Stereo
    capture; mic and system stay separate so Me is always
    correct."
- When **Best quality** is selected, the V073 "Listening on"
  row (Auto / Headphones / Speakers) is disabled with a helper:
  "Not used in Best quality — stereo capture eliminates bleed
  at the source."

### `scribe/src/renderer/features/meetings/MeetingHeader.tsx` (or
the equivalent currently-running-meeting indicator — verify)

- Subtle badge in the in-flight meeting toolbar showing the active
  capture mode when it's not the default. "Best quality" badge so
  the user knows why the bill is higher.

### `scribe/tests/parse-deepgram.test.ts` (extend)

- Explicit `channels: 2` + `multichannel=true` + `diarize=true`
  case: `channel_index === [0, 2]` words emit one segment with
  `speakerLabel: 'Me'`, channel 0; `channel_index === [1, 2]`
  words with `speaker: 0,1,2…` emit segments with
  `speakerLabel: 'Speaker 1', 'Speaker 2', 'Speaker 3'…`, channel 1.

### `scribe/tests/deepgram-query.test.ts` (extend)

- `channels: 2` branch sets `multichannel=true`; `channels: 1`
  branch does not.

### `scribe/tests/cost.test.ts` (new or extend, name TBD)

- `'cost-saver'` start → billed channels recorded as 1.
- `'best-quality'` start → billed channels recorded as 2.
- Per-meeting Usage & Cost computation uses the billed-channels
  count.

## Files changed

- `scribe/src/shared/ipc-contract.ts`
- `scribe/src/main/db/settings.ts`
- `scribe/src/main/ipc/settings.ts`
- `scribe/src/main/ipc/transcription.ts`
- `scribe/src/main/transcription/cost.ts` (verify name)
- `scribe/src/renderer/audio/capture.ts`
- `scribe/src/renderer/audio/worklet/pcm-framer.worklet.js`
- `scribe/src/preload/index.ts`
- `scribe/src/renderer/features/settings/SettingsModal.tsx`
- `scribe/src/renderer/features/meetings/MeetingHeader.tsx` (verify)
- `scribe/tests/parse-deepgram.test.ts` (extend)
- `scribe/tests/deepgram-query.test.ts` (extend)
- `scribe/tests/cost.test.ts` (extend or new)

## Verification

- `corepack pnpm test` — full suite passes. The V062 / V073
  test suites stay green because the cost-saver path is unchanged.
- `corepack pnpm typecheck` / `lint` — clean.
- Manual (mandatory — the legacy 2-channel path has been on the
  bench since V05; a live call is the only real validation):
  1. `corepack pnpm dev`. In Settings → Audio, pick **Best
     quality**.
  2. Run a 5-minute call with at least two remote speakers,
     listening on **laptop speakers** (the worst case for V073's
     bleed heuristic).
  3. Confirm: every "Me" segment is actually the user's voice
     (zero misattribution); remote speakers split cleanly into
     `Speaker 1`/`Speaker 2`/… on channel 1.
  4. After the call, confirm Settings → Usage & Cost shows
     billed channels = 2 for this meeting and the rate reflects
     the doubled bill.
  5. Switch back to **Cost-saver**, run another short call,
     confirm everything reverts to V073 behaviour (and the
     "Listening on" row re-enables).

§1 invariants: stereo capture stays RAM-only (no audio bytes on
disk — same as mono); keys stay main-side; renderer stays
sandboxed; no meeting-platform integrations; user notes sacred;
JSON contract unchanged; language auto-detect unaffected. The
billed-channels column on `meetings` is the only persistence
touched, and it's a pre-existing V05 column.
