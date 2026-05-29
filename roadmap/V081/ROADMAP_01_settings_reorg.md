# ROADMAP_01 — Settings reorganization

Pure renderer, all in `scribe/src/renderer/features/settings/SettingsModal.tsx`.
Tab registry is `TABS` (`:40`); `renderTab` switch (`:785`); left rail (`:816`).

## API Keys tab (below General)
- Insert `{ id: 'apiKeys', label: 'API Keys' }` right after `general` in `TABS`.
- Add `case 'apiKeys': return renderApiKeys();` to `renderTab`.
- New `renderApiKeys()` = the three `KeyRow`s (Deepgram, Gladia, Anthropic) + the
  "encrypted by your OS secure storage" note, **moved verbatim** from the
  `renderAi` "API keys" `<section>` (`:292-298`). `renderAi` keeps only **AI
  provider** + **Enhancement**.

## Audio tab — gray out Deepgram-only controls
- On the **Capture quality** ToggleGroup (`:417`) and the **Listening on /
  `audioCaptureMode`** ToggleGroup (`:441`), add `disabled={provider !== 'deepgram'}`
  (`provider` local state exists at `:125`).
- When disabled, replace the help text with a short note: "Available with Deepgram
  only." Keep the existing text for Deepgram.

## Transcription tab — remove filler toggle
- Delete the entire **Filler words** `<div>` block (`:511-529`).
- No main change: `getTranscriptIncludeFillers()` already defaults `true`
  (`db/settings.ts:222`), so fillers stay on for Deepgram with no UI.

## Transcription tab — bigger provider buttons + recommend Gladia
- Provider `ToggleGroup` (`:475`): `size="lg"` and a two-line card style per item
  (provider title + a one-line sub-label). Order **Gladia first** and add a small
  **"Recommended"** badge to it. Keep the existing per-provider help paragraph
  below.

## Verify
`corepack pnpm typecheck` + a `dev` pass: API Keys tab appears under General with
all 3 keys; AI tab no longer shows keys; Audio toggles are greyed unless Deepgram;
Transcription has no filler toggle and large provider buttons with Gladia
recommended.
