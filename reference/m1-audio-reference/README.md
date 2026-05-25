# Scribe — M1 audio capture reference

A standalone, runnable probe for the **riskiest** part of the build: capturing
**microphone + system (loopback) audio simultaneously on Windows, with no bot**,
mixing them into a single 2-channel 16 kHz PCM stream, and proving the data flows
— without storing any audio. If this runs and both meters move, the whole product
is viable. If it doesn't, you want to know now, before building anything on top.

This is a focused reference, not the full app. It implements only
`PRODUCT_SPEC.md` milestone **M1**.

## What it does

- **CH0 = microphone** (your voice) — captured via `getUserMedia`, processing off.
- **CH1 = system audio** (everyone else, as you hear them) — captured via
  `getDisplayMedia` with the main process granting `audio: 'loopback'`; the video
  track is requested only to satisfy Chromium and is discarded immediately.
- Both feed a 2-input `AudioWorklet` running under a **16 kHz** `AudioContext`
  (so the browser resamples — no hand-rolled resampler), which **interleaves**
  them into 16-bit PCM (`[mic, sys, mic, sys, …]` — the exact layout Deepgram
  multichannel `linear16` wants in M2) and posts ~100 ms frames to the UI.
- The UI shows a **VU meter per channel**, a frame counter, and total PCM
  streamed — then **drops every frame**. Nothing is written to disk.

## Run it (on a Windows 10/11 machine)

```bash
pnpm install      # or npm install
pnpm dev          # or npm run dev
```

A window titled “SCRIBE · m1 · audio capture probe” opens. Click **start
capture**, allow the mic prompt if shown, then:

- **Speak** → CH0 (green) should move.
- **Play any audio** (YouTube, a real Zoom/Teams/Meet call) → CH1 (amber) moves.

To package a runnable build: `pnpm build` then `pnpm preview`.

> Node ≥ 18 and pnpm recommended. Electron is pinned to v33 (loopback audio needs
> ≥ v31). First `pnpm install` downloads Electron, so it isn't instant.

## What success looks like

1. Both meters respond to the right sources independently.
2. The frame counter climbs ~10/sec; “pcm streamed” grows.
3. “saved to disk” stays **0 bytes — never**.
4. No bot/participant appears in any meeting you test against — because the app
   never touches the meeting platform, only your machine's audio.

## How this maps to the spec (and where it refines it)

- Implements `PRODUCT_SPEC.md` §6.1 (capture), §6.3 (multichannel layout),
  §6.4 (no persistence), and CLAUDE.md §1 invariants.
- **Refinement of §6.1:** the spec sketched `callback({ video: undefined, … })`.
  In practice Chromium requires a video source for `getDisplayMedia`, so the main
  process supplies a screen source and the renderer discards the video track.
  Update §6.1 to reflect this.
- **Refinement of §6.3:** instead of a `ChannelMergerNode`, this uses a
  **2-input AudioWorklet** — cleaner separation of the mic vs system signals and
  fewer moving parts. Recommend adopting this in the real build.
- **Simplification worth keeping:** forcing `AudioContext({ sampleRate: 16000 })`
  removes the need for a manual resampler entirely. The only caveat is rare
  drivers that refuse the rate (the code warns); M2 can add a worklet-side
  fallback resampler behind the same interface.

## What M2 adds (not here)

- `window.api.pushAudioFrame(pcm)` in the preload to forward frames to the **main
  process**, which opens the Deepgram WebSocket (so the API key never reaches the
  renderer) with `multichannel=true, diarize=true, encoding=linear16,
  sample_rate=16000`.
- Render live transcript with CH0 → “Me” and CH1 → diarized remote speakers.

## Troubleshooting

- **CH1 flat (system audio not captured):** the captured default output must match
  the device you actually hear the call on. Check *Settings → System → Sound →
  Output*. Bluetooth/USB devices sometimes drop out — test with built-in audio.
- **Mic prompt never appears / CH0 flat:** enable microphone access for desktop
  apps in *Settings → Privacy & security → Microphone*.
- **“No system audio track…” error:** loopback grant failed — confirm Electron is
  ≥ v31 and that `setDisplayMediaRequestHandler` in `src/main/index.ts` is reached.
- **AudioContext rate warning in console:** your driver refused 16 kHz; capture
  still works but you'll need the M2 fallback resampler before sending to Deepgram.

## Project layout

```
src/main/index.ts                      loopback grant + media permission + window
src/preload/index.ts                   minimal window.api bridge
src/renderer/index.html                CSP + root
src/renderer/src/main.tsx              React entry
src/renderer/src/App.tsx               VU-meter diagnostic panel
src/renderer/src/audio/capture.ts      AudioCapture: dual capture, mix, teardown
src/renderer/public/pcm-framer.worklet.js   interleave -> 16-bit PCM frames + RMS
```
