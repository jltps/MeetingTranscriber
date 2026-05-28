# ROADMAP_02 — Bleed-aware "Me" attribution

## Context

V05's mic-energy "Me" heuristic and V062's per-word refinement assume the
mic only hears the user. On headphones this is true; on **laptop
speakers** it isn't — the remote audio leaks back into the microphone,
and the per-word `mic >= sys * dominance` test starts mis-tagging remote
speakers as "Me". The user reported exactly this: remote turns being
shredded into a `Speaker N` / `Me` / `Speaker N` pattern through a single
remote monologue.

This block makes the dominance threshold adapt to live bleed instead of
being a constant, and adds a one-tap user override for people who know
their setup.

## What changed

### `scribe/src/main/transcription/me-attribution.ts`

- New `computeBleedScore(timeline, endMs, windowMs = 10_000)`. Computes
  the normalised zero-lag cross-correlation of the mic and system RMS
  envelopes over a rolling window. Frames where both channels are below
  `0.005` (silence) are excluded so room noise during quiet stretches
  doesn't distort the score. Pure function; returns `0..1` (clamped, so
  anti-correlated turn-taking shows as 0 rather than a negative).
- Guards against floating-point drift on constant envelopes:
  `if (micVar < 1e-10 || sysVar < 1e-10) return 0`. Without this, a
  perfectly flat synthetic timeline (variance ~0 with sub-epsilon noise)
  comes back as r ≈ 1, which would mis-fire the bleed compensation in
  unit tests and on truly silent stretches.
- `MeAttributionOptions` gains `captureMode?: AudioCaptureMode`
  (`'auto' | 'headphones' | 'speakers'`). `applyCaptureMode` clamps the
  computed bleed score: `'headphones'` → 0 (assume no bleed);
  `'speakers'` → max(0.5, bleed) (assume some bleed always); `'auto'` →
  pass through.
- `micDominatedWindow` now derives `effDominance = dominance * (1 +
  2.0 * bleed)` and `effFloor = micFloor * (1 + 1.0 * bleed)` from the
  live bleed score (sampled at `endMs`). At full bleed (1.0), the
  dominance bar quadruples from 1.5 to 4.5 — only crisp mic-only peaks
  qualify as "Me".
- `attributeWords` now post-processes its output through
  `medianFilterIsMe`: a 1-word median filter that flips a word's `isMe`
  back to its neighbours' value when it disagrees with **both** its
  neighbours *and* is shorter than 350 ms. Cuts the most common visible
  artefact — single-word "Me" interjections like `"Yeah."` in the middle
  of a remote monologue — without touching real interjections (which
  tend to come in 2+ words or longer durations).

### `scribe/src/shared/ipc-contract.ts`

- `AudioCaptureModeSchema = z.enum(['auto', 'headphones', 'speakers'])`.
- `SettingsView.audioCaptureMode: AudioCaptureMode` (defaults to
  `'auto'`).
- `SettingsApi.setAudioCaptureMode(mode)`.

### `scribe/src/main/db/settings.ts`

- New `getAudioCaptureMode()` / `setAudioCaptureMode(mode)` reading and
  writing the `audio_capture_mode` key in the existing KV `settings`
  table. **No migration.** Defaults to `'auto'`.

### `scribe/src/main/ipc/settings.ts`

- `settings:get` returns `audioCaptureMode`.
- `settings:setAudioCaptureMode` validates the input with
  `AudioCaptureModeSchema` and persists it.

### `scribe/src/main/ipc/transcription.ts`

- Snapshots `getAudioCaptureMode()` into a session-local `captureMode`
  on `transcription:start`. Passes `{ captureMode }` to both
  `attributeWords` (single-channel finals path) and the legacy
  `attributeMe` (interim + 2-channel path). The setting is read once
  per session — changing it mid-meeting requires Stop/Start, matching
  how the other transcription-level settings (language, provider)
  behave.

### `scribe/src/renderer/features/settings/SettingsModal.tsx`

- New "Listening on" row in the Audio section, between the mic picker
  and the language picker. A `ToggleGroup` (`Auto-detect` / `Headphones`
  / `Speakers`) writes the new IPC, with a one-line explanation of when
  to pick each one.

### `scribe/tests/me-attribution-bleed.test.ts` (new, 9 tests)

- `computeBleedScore`: zero on empty / constant / anti-correlated
  timelines; high (> 0.9) on a synthesised mic-tracks-sys envelope.
- `micDominatedWindow` under bleed: a 200 ms mic peak inside an
  otherwise-silent timeline still passes; a borderline 2× mic edge over
  a heavily bleeding window does not.
- `captureMode` overrides: `'headphones'` recovers the unmodified
  dominance behaviour; `'speakers'` rejects a 2× mic edge even on a
  clean timeline.
- Median filter: a 100 ms mic burst inside a long remote monologue gets
  flipped back to non-Me; longer / multi-word interjections are
  untouched.

## Files changed

- `scribe/src/main/transcription/me-attribution.ts`
- `scribe/src/main/db/settings.ts`
- `scribe/src/main/ipc/settings.ts`
- `scribe/src/main/ipc/transcription.ts`
- `scribe/src/shared/ipc-contract.ts`
- `scribe/src/preload/index.ts`
- `scribe/src/renderer/features/settings/SettingsModal.tsx`
- `scribe/tests/me-attribution-bleed.test.ts` (new)

## Verification

- `corepack pnpm test` — all suites pass. The existing
  `me-attribution.test.ts` and `me-attribution-words.test.ts` keep
  passing because their synthetic constant-envelope fixtures get a
  bleed score of 0 (variance epsilon guard), so the heuristic behaves
  exactly as before.
- Manual:
  1. **Laptop-speaker call** — start a short call with one remote
     speaker, listen on speakers. Confirm remote turns stay under their
     `Speaker N` label instead of flipping to `Me`.
  2. **Switch to headphones mid-meeting** — pick `Headphones` in
     Settings → Audio (note: takes effect on next Start), restart the
     session, confirm the user's own short interjections still
     attribute as `Me`.
  3. **Single-word "Yeah." artefact** — confirm a brief
     acknowledgement during a long remote stretch no longer breaks the
     segment apart in the transcript pane.

§1.7 holds — language detection is untouched. §1.6 holds — the
enhancement contract is not involved.
