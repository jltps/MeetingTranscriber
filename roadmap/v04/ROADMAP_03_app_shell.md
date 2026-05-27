# ROADMAP_03 — App Shell: Frameless + Custom Title Bar

Replace the stock Electron chrome with a branded, app-controlled shell. Today the
window has a default OS frame and ships Electron's generic native menu
(File/Edit/View/Window/Help) with default actions — and the menu has zero custom code.
This block goes **frameless** with a custom branded title bar, **removes the native
menu**, and establishes the in-app, command-driven action layer that the title-bar menu
and the command palette (block 05) both consume.

## Why
The generic native menu adds nothing and looks unbranded; a custom title bar gives the
app identity (logo, name, key actions, search) and matches modern desktop tools
(Granola/Linear). Centralizing actions in one registry means the title-bar menu, the
command palette, and keyboard shortcuts never drift apart.

## Depends on
**01** (overlay color follows the effective theme) and **02** (the bar uses real
`Button`/`DropdownMenu`). Block **09** supplies the final logo/name — use a placeholder
until then.

## Scope

1. **Frameless window + native window controls.**
   - `BrowserWindow`: `titleBarStyle: 'hidden'` + `titleBarOverlay: { color,
     symbolColor, height }` themed from block 01's effective theme (Windows draws the
     min/max/close controls into the reserved overlay region).
   - Re-color the overlay on `theme:changed` via `win.setTitleBarOverlay(...)`.

2. **Remove the native menu.**
   - `Menu.setApplicationMenu(null)`. Because this also removes default accelerators,
     re-add the **edit roles** the renderer depends on (clipboard for TipTap) — either a
     minimal, non-visible `Menu` with only `cut/copy/paste/selectAll/undo/redo` roles,
     or renderer keybindings (coordinated with block 05). Ctrl+C/V/X **must** keep
     working in the notes editor.

3. **Custom title bar.**
   - New `renderer/app/TitleBar.tsx`: brand identity (logo/name from block 09), an
     in-app menu trigger (shadcn `DropdownMenu`/menubar), and a thin drag region. The
     drag strip is `-webkit-app-region: drag`; every interactive control inside is
     `no-drag`. Leave space on the right for the native overlay controls.
   - Move the global actions that currently live in `MeetingSidebar` (New Note, Settings
     gear, "Ask across meetings") into the title bar / in-app menu.

4. **Action registry.**
   - New `renderer/app/actions.ts` (or `features/commands/registry.ts`): a typed list of
     app actions (`id`, `label`, `icon`, `run`, optional `shortcut`) — the single source
     consumed by the title-bar menu **and** block 05's palette. Examples: New note, Open
     settings, Toggle theme, Ask across meetings, Export, Enhance, Switch view/tab.

## Key decisions & caveats
- **Drag region vs text selection.** `-webkit-app-region: drag` swallows pointer events.
  Keep the drag strip thin and control-free; mark all buttons/inputs `no-drag`; never
  lay the drag region over selectable content.
- **Overlay color must follow theme.** Wire `setTitleBarOverlay` to the `theme:changed`
  broadcast from block 01; set the initial value at window creation from the persisted
  mode. A stale overlay color on theme switch is the classic bug here.
- **Don't break clipboard.** Removing the native menu kills default accelerators — the
  edit roles (or renderer keybindings) above are mandatory, not optional.
- **Untrusted-renderer posture is unchanged (§1.3).** Keep `setWindowOpenHandler` (deny)
  and `will-navigate` (prevent); frameless does not loosen sandbox/contextIsolation.
- **Windows-only.** macOS is out of scope (§12); `titleBarOverlay` semantics differ
  there — note it but don't build for it.
- Prefer the native overlay over hand-drawn window controls to keep the surface small;
  only add a `window:controls` channel if custom controls are truly needed.

## Touches
`main/index.ts` (`titleBarStyle`/`titleBarOverlay`, `Menu.setApplicationMenu(null)` +
minimal edit menu, overlay re-theme on change), optional `main/window.ts`, new
`renderer/app/TitleBar.tsx`, new `renderer/app/actions.ts`, `renderer/app/App.tsx`
(render the bar, reserve its height, relocate global actions),
`renderer/features/meetings/MeetingSidebar.tsx` (drop the now-duplicated brand/settings/
cross-chat header), `renderer/app/index.css`/`theme.css` (drag-region helpers).

## IPC to add
- Reuses `theme:changed` (block 01) to re-theme the overlay — no new theme channel.
- `window:controls` → `z.enum(['minimize','maximize','close','toggleMaximize'])` **only
  if** custom controls replace the overlay (default plan: use the overlay, skip this).

## Acceptance
- Window is frameless with themed native controls and a custom branded bar; drag works;
  in-app menu works; controls/inputs in the bar are `no-drag`.
- No native menu bar; Ctrl+C/V/X (and undo/redo) still work in the notes editor.
- The overlay recolors when the theme switches.
- §1.3 posture intact (sandbox/contextIsolation/navigation denials unchanged).
- `pnpm typecheck/lint/test/build` green.

## Out of scope
macOS traffic-light styling, multi-window, and any feature menu content beyond wiring
the action registry (the actions themselves are defined where their features live).
