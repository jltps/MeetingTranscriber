# ROADMAP_03 — Enhanced-Notes Summary Depths

**Type:** contract + UI · **Risk:** low–medium (touches the §1.6 contract) ·
**Coordinate with:** blocks 04 and 05 (same schema must be honored everywhere).

## Problem

Enhanced notes have a single depth — the full structured `blocks[]`. Users want two
views of the same meeting: a **key-points** summary they can skim/share, and the
**extended** notes for detail. Re-running enhancement to produce a second depth would
add API cost and risk divergence between the two.

## Goal

A single enhancement call returns **both** depths. The UI toggles between **Key points**
(concise) and **Extended** (today's full notes). No extra API round-trip, so the toggle
is free.

## Changes

### 1. Extend the `EnhancedNotes` contract (additively)

In `scribe/src/shared/types.ts` and `scribe/src/shared/ipc-contract.ts`
(`EnhancedNotesSchema`, around lines 157–166), add an **optional** field:

```ts
keyPoints?: string[];   // short, skimmable bullet summary of the meeting
```

Optional is deliberate: existing stored notes (`notes.enhanced_json`) and the
markdown-fallback path (`markdownFallbackToNotes` in `prompt.ts`) remain valid without
it. **No DB migration** — enhanced notes persist as JSON in a TEXT column, so the shape
extends transparently (§7 satisfied by the column already being JSON).

### 2. Have the enhancer emit key points in the same tool call

- `scribe/src/main/enhancer/anthropic.ts`: extend the `ENHANCE_TOOL` input schema (the
  forced `emit_enhanced_notes` tool) to include `keyPoints: string[]` alongside `blocks`.
  Keep `tool_choice` forcing the same single tool — one call, both outputs.
- `scribe/src/main/enhancer/prompt.ts`: in the **scaffold** (block 01's
  `SCAFFOLD_SECTION`) add a short directive: also produce `keyPoints` — the handful of
  highest-value takeaways (decisions, key outcomes, top action items) as concise
  standalone bullets, drawn from the same transcript/notes, no new facts.
- Make `repairBlocks` and the fallback paths **tolerant of a missing/empty `keyPoints`**
  (treat absent as `[]`). The markdown fallback keeps `keyPoints` empty.

### 3. UI depth toggle

The enhanced view currently toggles `Original` / `Enhanced` via a `ToggleGroup` in
`scribe/src/renderer/app/App.tsx` (lines ~703–714), rendering
`features/notes/EnhancedNotesEditor.tsx` for `Enhanced`.

- Add a depth switch shown when `view === 'enhanced'` and `keyPoints` is non-empty:
  **Key points** vs **Extended**.
  - **Extended** → the existing `EnhancedNotesEditor` (full editable blocks), unchanged.
  - **Key points** → a compact, read-only list rendering `keyPoints` (simple bullet list,
    using the existing notes typography tokens). Read-only is fine: key points are a
    derived summary; the editable, user-owned content lives in Extended.
- Decide the default: **Extended by default**, Key points one click away (matches today's
  behavior; least surprising). Keep the control in the same header cluster; mind block 06
  is decluttering that header, so place the depth toggle tidily next to the
  Original/Enhanced group.

## §1 invariants

- **§1.6** — `keyPoints` is part of the same Zod-validated tool output; on invalid output
  the existing retry → markdown-fallback path applies (with empty `keyPoints`). The
  contract stays app-owned.
- **§1.5** — key points are AI-derived and read-only; the user's editable notes are
  untouched. (When block 04's anti-tell post-process runs, it cleans `keyPoints` too,
  since they are `ai`-origin text.)

## Tests

- `EnhancedNotesSchema` parses notes **with** and **without** `keyPoints` (back-compat);
  rejects a non-string-array `keyPoints`.
- `repairBlocks`/fallback produce a valid object when the model omits `keyPoints`.

## Verification

`pnpm typecheck && pnpm lint && pnpm test`. Manual: enhance a meeting, confirm the
**Key points** / **Extended** toggle appears, Key points shows a concise bullet list,
Extended shows the full editable notes, and a previously-enhanced meeting (stored before
this change) still loads and renders (Key points toggle simply absent).
