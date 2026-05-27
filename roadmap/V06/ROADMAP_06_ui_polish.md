# ROADMAP_06 — UI Polish

**Type:** UI · **Risk:** low · **Independent** (land anytime).

## Problem

- The meeting header is crowded (title, template selector, organization controls,
  recording/language status, view toggle, export, enhance, start/stop) and **also** shows
  a per-meeting cost chip — too much for the top bar.
- The Settings dialog is `max-w-xl`, which is tight given the new sections this phase adds
  (provider config, depth/cost toggles).

## Changes

### 1. Remove the per-meeting cost chip from the header

In `scribe/src/renderer/app/App.tsx`, delete the cost `<span>` in the right-hand header
controls (around lines ~690–702) — the `~{formatCost(estimateCost(...))} · <duration>`
element. The full breakdown already lives in **Settings → Usage & Cost**
(`SettingsModal.tsx`, lines ~501–557), so no information is lost. Remove any now-unused
imports (`estimateCost` / `formatCost` / `formatAudioDuration`) **only if** they are not
used elsewhere in the file — check before removing. Leave every other header control
intact.

### 2. Enlarge the Settings dialog

In `scribe/src/renderer/features/settings/SettingsModal.tsx`, widen `DialogContent` from
`max-w-xl` (line ~198) to roughly **`max-w-3xl`**, keeping the existing `max-h-[85vh]`
flex-column layout and the inner `overflow-y-auto` scroll container so the longer sections
(provider config from block 05, the Economy/Quality toggle from block 04) sit comfortably.
Don't restructure the sections — just the width.

## §1 invariants

None affected — UI-only, no behavior change to audio, IPC, keys, or the contract.

## Tests

No new unit tests required. Keep the renderer smoke test green.

## Verification

`pnpm typecheck && pnpm lint`. Manual: confirm the header no longer shows the cost chip
and is less crowded; confirm cost is still visible under Settings → Usage & Cost; confirm
the Settings dialog is wider and still scrolls within `85vh`.
