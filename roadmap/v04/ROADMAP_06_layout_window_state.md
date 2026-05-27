# ROADMAP_06 — Layout & Window-State

Make the window remember itself and behave at any size. Today the window opens at a
fixed 1100×720 every launch, the sidebar width and the notes/transcript split are
hard-coded, and there is no responsive behavior — narrow the window and the side-by-side
layout breaks. This block **persists window and layout state** and adds **responsive
narrow-width** behavior.

## Why
A desktop app that forgets its size and position every launch feels unfinished. And the
side-by-side notes+transcript layout (the core screen) needs a graceful fallback when
the window is small or the user wants more room for one pane.

## Depends on
**03** (frameless window / title bar — maximized state interacts with the overlay) and
**01** (reuse the pre-paint bootstrap pattern so layout doesn't flash). Independent of
04/05.

## Scope

1. **Window-state persistence.**
   - New `main/window-state.ts`: track `BrowserWindow` bounds + maximized; debounce-save
     to a `window_state` setting; restore on creation, **clamped to the current display's
     work area** (handle an unplugged/changed monitor). Replaces the fixed 1100×720.

2. **Layout persistence.**
   - New `renderer/features/layout/use-layout.ts`: persist sidebar width and the
     notes/transcript split; a resizable splitter (Radix `ResizablePanelGroup` via shadcn,
     or a small hand-rolled handle). Collapsible sidebar (toggle is an action in the
     registry, so it's palette-accessible).

3. **Responsive / narrow-width.**
   - New `renderer/features/layout/use-responsive.ts`: a width observer → `'wide' |
     'narrow'`. In narrow mode, collapse notes + transcript into **tabs** (extend the
     existing Transcript/Chat tab pattern to include Notes) and collapse the sidebar.

## Key decisions & caveats
- **Clamp restored bounds.** Off-screen restore (monitor removed/resolution changed) must
  snap back to a visible display work area.
- **Debounce saves.** Saving on every resize/move event is chatty — debounce, and treat
  the `close` event as the authoritative final write.
- **Maximized + frameless overlay.** Maximize/restore must keep the title-bar overlay
  correct (coordinate with block 03).
- **Layout FOUC (lower stakes than theme).** Initial render before the layout setting
  loads can flash a default split. Either apply the persisted width via the same early
  bootstrap as theme, or accept a one-frame settle with a neutral default — document the
  choice.
- **Don't lose editor state** when toggling between wide and narrow (tabbing must not
  unmount/remount the notes editor in a way that drops unsaved content).
- Prefer a small typed `uiPrefs:get/set` channel for window-state + layout to keep them
  cleanly typed, rather than overloading the generic settings IPC. Decide in-block;
  either way it goes through the shared contract with Zod (§1.3, §4).

## Touches
`main/index.ts` (apply restored bounds; attach resize/move/maximize/unmaximize/close
listeners), new `main/window-state.ts`, new `renderer/features/layout/use-layout.ts` +
`use-responsive.ts`, `renderer/app/App.tsx` (consume layout mode; narrow-mode tabs;
apply persisted width/split; sidebar collapse), `renderer/features/meetings/
MeetingSidebar.tsx` (collapsed state), `main/db/settings.ts` (`window_state` + layout
getters/setters; decide whether wipe clears UI prefs — recommend yes for a true reset),
`shared/ipc-contract.ts` + `preload/index.ts` (if a `uiPrefs` channel is added).

## IPC to add
- Window-state can be handled entirely main-side from `BrowserWindow` events (no IPC).
- Recommended `uiPrefs:get` / `uiPrefs:set` (Zod-typed) for the renderer's layout prefs,
  rather than reusing the generic settings IPC. Add a `uiPrefs` namespace to `ScribeApi`
  if so.

Migration: none (settings table).

## Acceptance
- Relaunch restores window size, position, and maximized state; bounds are clamped to a
  visible display.
- Sidebar width and the notes/transcript split persist across launches.
- Narrowing the window switches notes/transcript to tabs (and back) without losing
  content; the sidebar collapses.
- Both themes; `pnpm typecheck/lint/test/build` green.

## Out of scope
Multi-window, detachable panels, saved layout presets, and per-meeting layout overrides.
