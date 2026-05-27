# ROADMAP_05 — Command Palette + Keyboard Shortcuts

Make the app fast to drive from the keyboard. A **Ctrl/Cmd-K command palette** over the
action registry, plus a consistent app-wide **keyboard-shortcut** scheme. This also
backfills the keyboard access lost when block 03 removed the native menu (menus give
accelerators for free; without one we provide them deliberately).

## Why
Power users expect Ctrl-K. Once the action registry (block 03) exists, a palette is a
thin, high-value layer on top of it — every action becomes searchable and bindable from
one place, with no risk of the menu and shortcuts drifting apart.

## Depends on
**02** (shadcn `command`/cmdk + `Dialog`) and **03** (the `actions.ts` registry + the
fact that the native menu — and thus default accelerators — is gone).

## Scope

1. **Command palette.**
   - New `renderer/features/commands/CommandPalette.tsx`: shadcn `Command` (cmdk) inside
     a `Dialog`, fed by the `actions.ts` registry. Fuzzy filter; show each action's
     shortcut; optionally surface recent/contextual actions first.
   - Opens on Ctrl/Cmd-K from anywhere; Escape closes and returns focus.

2. **Keyboard shortcuts.**
   - New `renderer/features/commands/use-shortcuts.ts`: a global keydown handler mapping
     chords → action ids, reading the **same** registry (shortcut metadata lives on the
     action). Cover: new note, focus search, toggle theme, open settings, ask across
     meetings, switch transcript/chat, navigate the meeting list.

## Key decisions & caveats
- **Renderer-only — not Electron `globalShortcut`.** `globalShortcut` is OS-global and
  out of scope; use renderer keydown so shortcuts fire only when the app is focused.
- **Never hijack typing.** Don't intercept chords while a text input or the TipTap
  editor is focused, except deliberate global ones (Ctrl-K). Avoid colliding with TipTap
  formatting (Ctrl-B/I/U) and browser defaults; prefer modifier combos for global
  chords.
- **Don't double-bind clipboard.** Block 03 owns the edit-role accelerators
  (Ctrl-C/V/X/Z); the palette/shortcut layer must not re-bind them.
- **Single source.** Palette and shortcuts both read `actions.ts` — no parallel list.
- **Reduced motion.** Palette open/close animation honors `prefers-reduced-motion`
  (verified in block 08).
- cmdk + Radix `Dialog` focus-trap interplay with the frameless bar — confirm focus
  return on close.

## Touches
New `renderer/features/commands/CommandPalette.tsx` and `use-shortcuts.ts`,
`renderer/components/ui/command.tsx` (shadcn primitive from block 02),
`renderer/app/App.tsx` (mount the palette, register the hook, wire actions to existing
handlers — `onNewNote`, `setShowSettings`, `setShowCrossChat`, theme toggle, view/tab
switches), `renderer/app/actions.ts` (shortcut metadata).

## IPC to add
None. Migration: none. (A future *global* hotkey would need a main-side channel — out of
scope here.)

## Acceptance
- Ctrl/Cmd-K opens a searchable palette listing every registered action; each runs
  correctly.
- Documented shortcuts work and do **not** fire while typing in the notes editor or
  inputs.
- Fully keyboard-operable; Escape returns focus; both themes; reduced-motion respected.
- `pnpm typecheck/lint/test/build` green.

## Out of scope
OS-global hotkeys, user-customizable keybindings, and command history persistence.
