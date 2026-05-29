# ROADMAP_02 — Onboarding: Gladia recommended + auto-select

`scribe/src/renderer/features/onboarding/OnboardingFlow.tsx`. The `keys` step
(`:101-122`) renders Deepgram + Anthropic `KeyRow`s.

- Add a **Gladia `KeyRow`** between Deepgram and Anthropic, labelled
  "Gladia (recommended)".
- Reframe the step copy: transcription can use **Gladia — recommended; adds
  post-call insights (speaker diarization, entities, sentiment)** — or Deepgram;
  **Anthropic** powers enhancement. Keys are encrypted locally; can be added later.
- **Auto-select Gladia**: pass the Gladia row an `onSaved` wrapper that calls
  `window.api.settings.setTranscriptionProvider('gladia')` then the existing
  `onChanged` (so the provider flips to Gladia when its key is saved). Mirrors
  Settings' `handleSetProvider`. Deepgram stays the fallback when no Gladia key.

## Verify
`dev`: first-run onboarding shows Gladia as recommended; saving a Gladia key sets
the transcription provider to Gladia (confirm in Settings → Transcription).
