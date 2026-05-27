# ROADMAP_01 — Diarization + Language Accuracy

Make the existing Deepgram path actually separate remote speakers, and make
single-language meetings use the dedicated (more accurate) model instead of the
code-switching one. This is the precise fix for the two reported quality bugs and is
**shipped in this phase**.

## Why
- **Merged speakers (the headline bug).** The Deepgram query string sent
  `multichannel=true` but **never `diarize=true`** — despite the code comment claiming
  otherwise. `parse.ts` reads `word.speaker ?? 0`, and with diarization off Deepgram
  never populates `speaker`, so every word on the system channel collapsed to one
  "Speaker 1". Two people on the system/loopback channel can only be separated by
  diarization — `multichannel` splits *channels*, not *speakers*.
- **Wrong-language words.** Auto mode sends `language=multi`, nova-3's 10-language
  *code-switching* model, which hallucinates foreign words in a single-language meeting.
  nova-3 now ships dedicated pt-PT/pt-BR models with >20% lower streaming WER; a fixed
  language routes to them.

## Depends on
Shipped v1 (diarized-segment parser already exists in `parse.ts`). No audio-graph
change. No new dependency.

## Scope
1. **Enable diarization.** Add `diarize=true` to the Deepgram params in
   `main/transcription/deepgram.ts`, alongside the existing `multichannel=true`
   (combining the two is supported). The existing `splitBySpeaker()` in `parse.ts` then
   correctly splits the system channel per speaker — no parser change required.
2. **Smart formatting.** Add `smart_format=true` for better numbers/dates/readability
   (a free quality win on top of `punctuate`).
3. **Language guidance.** For a single-language meeting, a *fixed* language (e.g.
   `pt-PT`) is both more accurate and ~17% cheaper per channel than `multi`. The fixed
   options already exist in Settings; document that `auto` (=`multi`) is for genuinely
   mixed-language calls only.
4. **Pricing accuracy.** Refresh the rate comment/sources in `shared/pricing.ts` to the
   current nova-3 streaming rates ($0.0048 mono / $0.0058 multi per channel) and note
   the per-channel doubling that block 02 removes.

## Key decisions & caveats
- **Diarization is always on for Deepgram.** Multi-speaker meetings are the whole point;
  no need for a toggle. (An optional Deepgram *model* picker — nova-3 vs nova-2 for
  languages nova-3 lacks — is a reasonable later enhancement, mirroring the existing
  Whisper model picker, but is not required for the bug fix.)
- **Channel 0 stays "Me".** `parse.ts` still forces the mic channel to "Me" regardless of
  diarization; diarization only affects the system channel here.
- **Cost note:** this block does not reduce cost (still 2 billed channels); it may add a
  small diarization surcharge. The cost win is block 02.

## Touches
`main/transcription/deepgram.ts` (params + comment), `shared/pricing.ts` (comment/rates),
`tests/deepgram-parse.test.ts` (lock multi-remote-speaker splitting).

## Acceptance
- A ≥3-person call gives the two remote speakers **distinct** labels (Speaker 1 / Speaker
  2), not one merged speaker.
- A Portuguese meeting on a fixed `pt-PT`/`pt-BR` setting shows no foreign-language words.
- `pnpm typecheck/lint/test` green.

## Out of scope
The mono/cost change (block 02). Speaker *naming* (v03 ROADMAP_02 already shipped). Any
audio-capture-graph change.
