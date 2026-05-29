# ROADMAP_00_INDEX.md

> **Status: shipped in v0.8.1.** All six blocks below are merged to `main`; see
> `README.md` + `SHIPPED_HISTORY.md` for the shipped summary. Quality-of-life pass on top of V08
> (Gladia STT + post-call insights). Surfaces Gladia as a first-class
> *recommended* provider, reorganizes Settings + the note header, fixes
> multi-session recording into one note, and turns the Insights view into an
> at-a-glance dashboard using the **full Gladia sentiment + emotion taxonomy**.

The **V081 backlog — quality-of-life updates.** Driven by real use after V08:

- Onboarding and Settings don't yet present Gladia as the recommended provider.
- Several controls sit in the wrong place (API keys buried in the AI tab; the
  template selector in the app header; the Insights tab in the note header
  instead of beside Extended/Key points).
- Deepgram-only audio controls (capture quality, "Listening on") are live even
  when Gladia/Whisper is selected.
- Recording a second time into a note **interleaves** with the first transcript
  (timestamps reset per session) instead of appending.
- The Insights view dumps the full enriched transcript (already shown live) and
  collapses Gladia's sentiment to 3 labels, dropping `mixed`/`unknown` + the 25
  emotions.

### User decisions baked in
- **Append**: auto-append + a *friendly* banner (no confirm dialog) + a visible
  "Session N" divider; enhancement still treats all sessions as one.
- **Insights placement**: a sub-tab **under Enhanced**, beside Extended / Key
  points (the note header keeps Original / Enhanced).
- **Onboarding**: adding a Gladia key **auto-selects** Gladia as the provider.

### Gladia taxonomy (from docs, used by block 06)
- **Sentiments (5):** `positive, negative, neutral, mixed, unknown`.
- **Emotions (25):** adoration, amusement, anger, awe, confusion, contempt,
  contentment, desire, disappointment, disgust, distress, ecstatic, elation,
  embarrassment, fear, interest, pain, realization, relief, sadness,
  negative_surprise, positive_surprise, sympathy, triumph, neutral.

§1 invariants hold throughout (no audio on disk, keys main-side, renderer
untrusted, notes sacred, never default to English). Most blocks are
renderer-only; the deeper two are block 05 (DB + IPC append) and block 06
(sentiment-model widening).

## The blocks

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | Settings reorganization | New **API Keys** tab below General (move the 3 KeyRows); gray out capture-quality + "Listening on" unless Deepgram; remove the filler-words toggle (stays on by default); bigger provider buttons with Gladia recommended. | Renderer |
| 02 | Onboarding | Add a Gladia KeyRow (recommended) + reframed copy; saving a Gladia key auto-selects the Gladia provider. | Renderer |
| 03 | In-note controls | Move the template selector into the note header (first, before folders); move Insights to a sub-tab under Enhanced beside Extended/Key points; clicking an occurrence jumps the live transcript. | Renderer |
| 04 | Tags select-or-create | Replace the tags dropdown + separate "New tag…" dialog with one searchable combobox (cmdk): filter/pick existing **or** create inline. | Renderer |
| 05 | Multi-session append | Migration **v15** `session_seq`; offset a new recording past the existing transcript; friendly banner; "Session N" dividers; show prior+live while recording; align Gladia insights offset; export carries `session_seq`. | DB + IPC + renderer |
| 06 | Richer insights + full taxonomy | Widen sentiment to 5 values + keep all emotions; preserve real values in parse; a pure aggregator; redesign InsightsView into a dashboard (no transcript) — speaker time + %, all sentiments/emotions with expandable occurrence times, top entities; markdown export. | Shared + main + renderer |

## Dependencies / order
```
01 settings ─┐ (independent renderer)
02 onboarding┘
03 in-note (template move + Insights sub-tab) ──► consumes 06's InsightsView redesign
04 tags combobox (independent renderer)
05 append (DB v15 + IPC offset + renderer dividers) — independent of 06 except both
   touch the Gladia insights offset alignment (05 adds sessionBaseMs to finalizeInsights)
06 insights model widening + dashboard ──► used by 03's sub-tab
Suggested: 06 (model+view) → 03 (placement) → 01 → 02 → 04 → 05. Tests throughout.
```

## Cross-cutting
- Reuse existing primitives: shadcn `ToggleGroup`/`Select`/`Button`/`Popover`,
  `cmdk` (palette pattern), the source-link **highlight/jump** (`setHighlight` +
  `TranscriptHighlight`), `useOrganization` (tag CRUD), `formatTalk`/`formatTime`.
- One additive migration (**v15**), no DROP/recreate. Insight `utterances` are
  already stored (V08) and carry per-occurrence timestamps — the dashboard needs
  no new persisted data beyond the widened sentiment label.
- `corepack pnpm typecheck/lint/test/build` green at every commit; commit per
  block to `main` (memory `commit-to-main`).
