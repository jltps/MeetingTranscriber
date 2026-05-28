# ROADMAP_01 — Bullet-proof Windows audio capture

## Context

Several users reported, across different Windows 10/11 machines, that
either the microphone or the system loopback wasn't being captured —
sometimes intermittently, sometimes consistently on one box but not
another. Tracing through `capture.ts`, `loopback.ts`, and
`pcm-framer.worklet.js` revealed three silent-failure paths:

1. **Stale `{ exact: deviceId }`** — `acquireMicStream` failed with
   `OverconstrainedError` when the stored ID (Bluetooth headset, USB mic
   re-plugged into a different port) was no longer valid, and the call
   gave up instead of retrying with `{ ideal: id }` or the system
   default. No UI surfaced the problem.
2. **Empty `desktopCapturer.getSources({ types: ['screen'] })`** — over
   RDP, on certain HDMI-only setups, and in some VM hosts, the screen
   list comes back empty. The main handler called
   `callback({ video: sources[0], audio: 'loopback' })` with
   `sources[0] === undefined`, which Chromium rejects → `getDisplayMedia`
   threw with no path forward.
3. **Hard-pinned 16 kHz AudioContext** — some WASAPI endpoints
   (Bluetooth A2DP, certain Realtek drivers) silently came up at 44.1 or
   48 kHz despite the request, and the worklet then shipped PCM at the
   wrong rate. Deepgram returned gibberish; the user blamed the model.

This block makes every one of those failures either auto-recover or
surface a clear in-app message — never silent.

## What changed

### `scribe/src/renderer/audio/capture.ts`

- New exported helper `acquireMicStream(deviceId?)` returning
  `{ stream, step }` where `step ∈ 'exact' | 'ideal' | 'system-default'`.
  Tries the stricter constraints first; falls through on
  `NotFoundError` / `OverconstrainedError` etc. Throws a typed
  `CaptureError('mic-unavailable', cause)` only after the system-default
  attempt also fails.
- New `CaptureError` class with `kind ∈ 'mic-unavailable' |
  'loopback-denied' | 'no-system-audio'` so the UI can pattern-match per
  failure mode.
- `AudioCapture.start`:
  - Routes mic acquisition through `acquireMicStream`.
  - Wraps `getDisplayMedia` in its own try/catch → `CaptureError('loopback-denied', …)`.
  - Drops the explicit `new AudioContext({ sampleRate: 16000 })` —
    we now construct `new AudioContext()` and read `ctx.sampleRate` after
    the fact (the OS-preferred rate). The actual rate plus the chosen
    target (16000) ride into the worklet via `processorOptions`.
  - `onReady` payload now includes `micFallbackStep` so diagnostics can
    show *which* fallback won.
- New exported `runCaptureProbe({ micDeviceId?, durationMs? = 1500 })` →
  `{ micRmsPeak, sysRmsPeak, micFrames, sysFrames, sampleRate, sysMuted,
  micFallbackStep, error? }`. Spins up capture briefly, observes whether
  mic + loopback actually produce signal, then tears down. Used for
  Settings → "Test capture" today; the meeting-start preflight modal
  hooks in here when added later.

### `scribe/src/renderer/audio/use-audio-capture.ts`

- Surfaces `micFallbackStep` through `AudioCaptureController` so
  `CaptureProbe.tsx` can render a "fell back to system default" notice.

### `scribe/src/renderer/public/pcm-framer.worklet.js`

- Reads `processorOptions.sourceRate` + `targetRate` (defaults
  16 kHz). When `sourceRate === targetRate`, runs the fast pass-through
  path. When they differ, linear-interpolates from source to target
  inside each quantum, carrying one source-sample of state across
  quantum boundaries so the read head stays continuous. Voice is band-
  limited around 4 kHz, so linear-interp artefacts are imperceptible to
  the recognizer.

### `scribe/src/main/audio/loopback.ts`

- `setupAudioCapture` now calls `resolveLoopbackResponse()` which tries
  in order: `screen` sources → `window` sources → an audio-only response
  (`{ audio: 'loopback' }`, accepted by Electron 33). When even that
  fails (which is rare; usually only when both enumerations throw) it
  pushes `audio:loopbackDenied` over IPC to every renderer with a
  human-readable `reason` so the UI can surface guidance.
- Imports `BrowserWindow` from electron so the helper can send to all
  open windows (single-window today; future-proof against multi-window).

### `scribe/src/main/ipc/transcription.ts`

- New per-session silence watchdog. Counts frames where `micLevel >=
  0.005` and `sysLevel >= 0.005` separately. After a 3 s grace period:
  - If `micSignalFrames === 0` → push `transcription:warning`
    `{ kind: 'mic-silent', message }`.
  - Else if `sysSignalFrames === 0` → push
    `{ kind: 'system-silent', message }`.
- When signal returns it pushes `{ kind: 'cleared', message: 'Audio is
  back.' }` so the UI banner auto-dismisses.
- State is reset on start + stop so the next session starts clean.

### `scribe/src/shared/ipc-contract.ts`

- New channels:
  - `audio:loopbackDenied` (push, main → renderer): `{ reason: string }`.
  - `transcription:warning` (push, main → renderer): `{ kind: 'mic-silent' |
    'system-silent' | 'cleared', message: string }`.
  - `settings:setAudioCaptureMode` (request, renderer → main):
    `AudioCaptureMode` (see block 02).
- `ScribeApi` gains `onAudioLoopbackDenied` and `onTranscriptionWarning`.

### `scribe/src/preload/index.ts`

- Wires the two new push subscriptions with Zod validation in the
  listener (same pattern as `onTranscriptSegment`).

### `scribe/src/renderer/features/settings/AudioWarningBanner.tsx` (new)

- Subscribes to both push channels and renders an inline warning strip
  between `UpdateBanner` and the main layout. `cleared` events
  auto-dismiss the watchdog warning; an explicit "Dismiss" button closes
  loopback-denied notices.

### `scribe/src/renderer/app/CaptureProbe.tsx`

- Drops the "not 16 kHz" warning that always fired post-V073 (the rate
  is now always negotiated). Now shows `sourceRate → 16000 Hz` as an
  info row + a fallback warning when `micFallbackStep === 'system-default'`.

## Files changed

- `scribe/src/main/audio/loopback.ts`
- `scribe/src/main/ipc/transcription.ts`
- `scribe/src/renderer/audio/capture.ts`
- `scribe/src/renderer/audio/use-audio-capture.ts`
- `scribe/src/renderer/public/pcm-framer.worklet.js`
- `scribe/src/shared/ipc-contract.ts`
- `scribe/src/preload/index.ts`
- `scribe/src/renderer/app/App.tsx` (mounts `AudioWarningBanner`)
- `scribe/src/renderer/app/CaptureProbe.tsx`
- `scribe/src/renderer/features/settings/AudioWarningBanner.tsx` (new)

## Verification

- `corepack pnpm typecheck` — clean.
- `corepack pnpm test` — 256 / 256 pass.
- `corepack pnpm lint` — clean on every V073-touched file.
- Manual probe (record one short meeting per scenario):
  1. **Unplug headset mid-session** — watchdog should NOT fire (signal
     continues via fallback to default), and the banner should stay
     down.
  2. **Boot with a stale Bluetooth ID stored** — capture should fall
     through `exact` → `ideal` → `system-default`; `CaptureProbe` shows
     the "fell back to system default" warning row.
  3. **Force a 48 kHz output device** — sample-rate row shows `48000 Hz
     → 16000 Hz`, transcript is intelligible.
  4. **Mute the Windows output device** — loopback grant succeeds but
     `sysTrack.muted` flips true → CaptureProbe shows the existing
     "muted — source is delivering silence" line.

§1.1 holds (RMS scalars only; no audio on disk). §1.3 holds (every new
IPC channel is Zod-validated in the contract).
