# ROADMAP_03 — Hybrid & Fully-Offline Transcription

Two paths that further cut (or eliminate) cloud cost. **03a (hybrid)** is the documented
fallback for block 02; **03b (offline)** is the long-term $0 endgame, deferred until a
no-cloud mode is prioritized.

## 03a — Hybrid: local mic ("Me") + cloud system ("Them")

### Why
Halves the cloud bill *and* keeps "Me" exact (no heuristic) — the safe fallback if block
02's mono+energy approach proves unreliable in real meetings (e.g. speaker bleed).

### Scope
- **Mic (channel 0)** → transcribed locally by the existing Whisper path
  (`main/transcription/whisper.ts`) → always "Me", always correct, $0.
- **System (channel 1)** → Deepgram as a *single* channel with `diarize=true` → remote
  speakers separated. Only one channel billed → cost halved.
- Merge the two segment streams on a shared timeline in `main/ipc/transcription.ts`.

### Key decisions & caveats
- Two engines run at once — more moving parts. The local Whisper processes ~5 s chunks,
  so the user's *own* live partials lag the realtime cloud "them" stream; decide whether
  to show "Me" partials or only finals.
- Reuses the already-shipped Whisper provider; no new dependency.
- Keep the capture graph producing both channels (unlike block 02's mono mix); route mic
  PCM to Whisper, system PCM to Deepgram.

### Acceptance
"Me" is always correctly attributed with zero mic cloud cost; remote speakers separated;
cloud cost ~halved; live ≥3-person call validated.

## 03b — Fully offline (WhisperX-style) — deferred

### Why
Zero ongoing cost and no audio leaves the machine — the strongest possible fit with the
§1 privacy ethos. The long-term endgame for cost.

### Scope (when prioritized)
- Replace cloud STT with faster-whisper + pyannote diarization on-device, behind the
  existing `TranscriptionSession` interface. The current `@xenova/transformers` Whisper
  has no diarization, so this needs a heavier local runtime.

### Key decisions & caveats
- Heavy native dependency; needs a capable CPU/GPU; higher latency than cloud streaming;
  large engineering lift and packaging work (model files / runtime).
- Make model size a user choice and set hardware expectations (mirrors the v03 Whisper
  block's guidance).
- Keep Deepgram selectable — this is an alternative, not a forced replacement.

### Acceptance
A meeting transcribes fully offline with separated speakers and acceptable latency on a
capable machine; "Me vs them" preserved (channel or diarization based).

## Out of scope (both)
Local LLM *enhancement* — the Claude enhancement call stays cloud unless separately
specced.
