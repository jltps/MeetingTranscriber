# ROADMAP_02 — Updater UI (renderer)

## Problem

Block 01 ships a working updater in main — checks, downloads, holds an install-
ready state — but the renderer has no way to surface any of it. Users wouldn't
know an update is ready. Block 02 puts a face on the engine.

## Goal

Three small UI surfaces that together cover the lifecycle:

1. **Non-intrusive banner** that appears when phase is `downloaded`: "Update
   ready (vX.Y.Z) — restart to install." With a "Restart now" button and a
   "Later" dismiss. Reappears on the next phase transition.
2. **Settings → Updates panel**: auto-update toggle, "Check now" button,
   current installed version, last-checked timestamp, current update phase
   (with progress percent while downloading).
3. **About dialog**: small modal showing the app version, a link out to the
   GitHub Releases page, and a "Check for updates" shortcut. Opened from the
   existing TitleBar menu (or a new menu item adjacent to the settings cog).

All three consume the IPC + preload bridge added in block 01
(`window.api.updates.{checkNow, install, getState, onStatus}`).

## Non-goals

- Release-notes rendering richer than a short Markdown blurb (use the
  existing `react-markdown` + `remark-gfm` already in the stack).
- Per-release changelog history view.
- "What's new in this version" tour after install.
- Multiple update channels (no beta toggle).
- Any change to engine behavior.

## Approach

### 1. Banner — `scribe/src/renderer/features/updates/UpdateBanner.tsx`

A new feature folder under `scribe/src/renderer/features/updates/` (mirrors the
existing per-feature layout — see `features/meetings/`, `features/chat/`).

- Subscribes to `window.api.updates.onStatus` on mount; reads
  `window.api.updates.getState()` for the initial snapshot.
- Renders **only** when `state.phase === 'downloaded'`. Other phases produce
  no banner (the Settings panel is the place for "downloading 42%" detail —
  the banner stays out of the way until the user can actually act).
- Uses an existing shadcn/ui surface — likely a thin top-of-window bar (sticky
  above the main content) styled with `bg-primary/10` + `border-b`. Match the
  visual weight of similar in-app system messages already in the codebase;
  during implementation, grep for any existing notification / status bar
  pattern and reuse rather than introducing a new one.
- Two actions:
  - **"Restart now"** → `window.api.updates.install()`. On `{ ok: false,
    reason: 'recording' }`, swap the banner text to: "Restart to update will
    happen when your meeting ends." (Banner remains.)
  - **"Later"** → local dismiss for this session only (no persistence — the
    banner reappears next launch if still applicable).
- Mount point: the renderer root layout (`scribe/src/renderer/app/App.tsx`)
  just above the existing main content / sidebar split. Determine the exact
  insertion point by reading App.tsx during implementation.
- Accessibility: `role="status"` for the announcement, focusable actions, ESC
  dismisses (same as the dismiss button), respects `prefers-reduced-motion`
  for any transition. This is a V04 a11y norm already established in the app.

### 2. Settings → Updates panel — `scribe/src/renderer/features/settings/sections/UpdatesSection.tsx`

A new section inside the existing `SettingsModal.tsx`
(`scribe/src/renderer/features/settings/SettingsModal.tsx`, lines 1–675). The
modal already has section components per topic; match that pattern.

Layout (top-to-bottom):

- **Current version row**: "Nexus 0.6.1" — read once from `window.api.
  getStatus().appVersion` (already exposed in main, see `scribe/src/main/ipc/
  app.ts:10`).
- **Status row** — derived from current `UpdateState`:
  - `idle` / `none` → "Up to date" + last-checked timestamp.
  - `checking` → "Checking…" with spinner.
  - `available` → "Downloading vX.Y.Z…"
  - `downloading` → "Downloading vX.Y.Z… 42%" with a progress bar.
  - `downloaded` → "vX.Y.Z ready to install" + inline "Restart now" button
    (same install action as the banner, including recording-guard handling).
  - `error` → "Couldn't check for updates" + short message + retry button.
- **Auto-update toggle** (shadcn `Switch`): bound to `auto_update_enabled`
  setting. Off ⇒ no boot-time check, no timer; the "Check now" button still
  works.
- **Check now button**: disabled when phase is `checking`/`downloading`.
  Calls `window.api.updates.checkNow()`.
- **Release notes** (when `available`/`downloaded` and present): rendered with
  the existing `react-markdown` + `remark-gfm` pipeline that V06 added for
  chat. Wrap in a `max-h-48 overflow-auto` to keep the panel compact.

Add the new section to the SettingsModal's section list (`SettingsSection`
enum or equivalent — verify naming during implementation; match existing
sections like "Usage & Cost" or "Templates").

### 3. About dialog — `scribe/src/renderer/features/updates/AboutDialog.tsx`

Small shadcn `Dialog`. Triggered from:

- A new menu item in the existing `TitleBar.tsx` actions area (a small "ⓘ" /
  info button adjacent to the settings cog) — match the icon weight of the
  three actions already there (sidebar toggle, cross-chat, settings).
- (Optional) a footer link in the Settings → Updates panel ("About Nexus").

Contents:

- App icon (use the existing `renderer/assets/logo.svg`).
- "Nexus vX.Y.Z" — `window.api.getStatus().appVersion`.
- One-line tagline (pull from `README.md` first line or hard-code a short
  one — decide during implementation).
- Two links:
  - **Releases page**: opens `https://github.com/<owner>/<repo>/releases` in
    the system browser via `shell.openExternal`. Resolve `<owner>/<repo>` at
    build time from the same source `electron-builder.yml` block 01 used; if
    that's cumbersome, expose a small `getReleasesUrl()` IPC handler in main.
  - **License / repo**.
- **Check for updates** button (same handler as the Settings → Updates panel
  button) for users who land here first.
- Close button.

## Verification

### Unit/component tests

This codebase already tests some renderer logic (verify the convention during
implementation — look for any `*.test.tsx` near existing features). If there
is no renderer test infrastructure, skip component-level tests and rely on
manual verification + the engine's unit tests from block 01.

If renderer tests exist:

1. **Banner renders only in `downloaded`.** Mock `useUpdateState()` to return
   each phase; assert the banner DOM is absent for all but `downloaded`.
2. **Install button calls bridge.** Mock `window.api.updates.install` to
   resolve `{ ok: true }`; click; assert call made.
3. **Recording-guard message swap.** Mock `install` to return `{ ok: false,
   reason: 'recording' }`; click; assert the banner text becomes the
   "meeting in progress" copy.

### Manual verification

Requires block 01 shipped and a hand-made GitHub Release as in block 01's
verification. Run from `scribe/` with `corepack pnpm dev` (then a packaged
build for the install flow):

1. **Boot 0.6.1 with 0.6.2 published**: banner appears within ~60 s once
   download completes. Click "Restart now" → app updates.
2. **Boot 0.6.1 with no newer release**: Settings → Updates shows "Up to
   date — checked <timestamp>". Banner never appears.
3. **Boot 0.6.1, disable auto-update, restart**: no automatic check; "Check
   now" still works; toggle persists across launches (write to settings KV
   correctly).
4. **Recording guard via UI**: start a meeting, then trigger "Restart now"
   from the banner — banner text swaps to the "after the meeting" copy.
   Stop the meeting; click again → installs.
5. **About dialog**: opens, shows current version, "Releases" link opens the
   browser to the right URL.
6. **Reduced motion / contrast / keyboard**: V04 a11y norms hold — banner
   reachable by Tab, ESC dismisses, contrast passes AA in both themes.

### Type/lint/test/build gates

`corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test &&
corepack pnpm build` all clean before commit.

## §1 invariants — affirmation checklist

- **§1.1 No audio touched.** Renderer-only UI; no audio paths involved.
- **§1.2 No keys in renderer.** UI only consumes the typed
  `window.api.updates.*` bridge; no key handling.
- **§1.3 Renderer untrusted.** UI cannot bypass main; it only calls the four
  bridge methods exposed in block 01.
- **§1.5 User notes are sacred.** The banner respects the recording-guard
  response from main; never coerces a quit while a meeting is live.
- **§1.6 / §1.7.** Unaffected.

## Acceptance

- New `scribe/src/renderer/features/updates/` with `UpdateBanner.tsx`,
  `AboutDialog.tsx`, and any small hooks (e.g. `useUpdateState`).
- New section in `SettingsModal` registered + reachable.
- TitleBar gains an About entry.
- Banner mounts at the right layout level, appears only in `downloaded`
  phase, handles the recording-guard response.
- Manual verifications above pass.
- One commit, directly to `main`, Conventional Commits (`feat(updater): UI for
  …`).
