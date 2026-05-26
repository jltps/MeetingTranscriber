# ROADMAP_05 — Local / Offline Transcription (Whisper)

A fully on-device transcription provider behind the existing `TranscriptionSession`
interface, as an alternative to Deepgram.

## Why
- **Cost:** removes the per-minute (×2 channel) Deepgram bill. Block 01's cost
  readout quantifies the payoff.
- **Privacy:** audio never leaves the machine for transcription.
- **Code-switching:** Whisper-class models handle mixed-language speech and native
  per-language auto-detect better than a single-language-locked cloud session,
  which directly helps the language work in `FEATURES_LANGUAGE_PROMPT_TEMPLATES.md`.

## Depends on
The transcription interface staying swappable (it was designed to be). No UI rework
if the interface held.

## Scope
- A local provider (e.g. faster-whisper / whisper.cpp class) implementing
  `TranscriptionSession`, selectable in Settings as an alternative to Deepgram.
- Real-time-ish streaming from the same 2-channel 16 kHz PCM the capture pipeline
  already produces; keep mic = channel 0 = "Me".
- Native language auto-detect; expose `detectedLanguage()` the same way.
- Model management: download/select model size; warn on hardware that is too slow.

## Key decisions & caveats
- **Quality/speed tradeoff is real.** Small models are fast but weaker; large models
  need a capable CPU/GPU. Make model size a user choice and set expectations.
- Diarization is not built into Whisper; either keep per-channel "Me vs them" only,
  or add a separate diarization step. Decide explicitly; do not silently lose the
  speaker separation v1 has.
- Keep Deepgram as an option; this is an alternative, not a forced replacement.
- Still no audio to disk: stream PCM to the local model in memory, same rule.

## Touches
A new provider under transcription, Settings (provider + model picker, download
management), packaging (model files / runtime).

## Acceptance
- User can switch to local transcription and run a meeting fully offline.
- A Portuguese-with-English call transcribes better than the cloud single-language
  session did.
- "Me vs them" separation is preserved (or a deliberate alternative is in place).

## Out of scope
Local LLM enhancement (the Claude call stays cloud unless separately specced).
