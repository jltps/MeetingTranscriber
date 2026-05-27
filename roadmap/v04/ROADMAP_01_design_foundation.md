# ROADMAP_01 — Design Foundation: Tailwind v4 + Tokens + Theming

Give the app a real design system and the ability to reskin itself. Today every
color is a literal Tailwind class (`bg-neutral-950`, `text-neutral-200`) or raw hex in
`index.css`, the app is hard-coded dark, and there is no theming of any kind. This
block introduces **semantic CSS-variable design tokens** and **light / dark / system**
themes, on top of a **Tailwind v3.4 → v4 migration**. Brand accent: **emerald/teal**.
Personality: **calm & minimal**.

## Why first
Everything visual in V04 consumes these tokens. shadcn (block 02) maps its variables
onto them; the title bar (03) themes its overlay from the effective theme; onboarding,
empty states, and the a11y contrast work all assume tokens exist. No other block
should be styled before this lands.

## Depends on
Nothing. This is the first block.

## Scope

1. **Tailwind v4 migration.**
   - Swap the PostCSS plugin to `@tailwindcss/postcss`; drop `autoprefixer` (v4 bundles
     it). Replace `@tailwind base/components/utilities` with `@import "tailwindcss"`.
   - **Set the dark strategy to selector/class** — v4 defaults to the
     `prefers-color-scheme` media strategy, which can't express an explicit light
     choice on a dark OS. Use `@custom-variant dark (&:where(.dark, .dark *))` (or
     `darkMode: 'selector'`). This is the single most important migration setting.
   - Audit utilities the migration silently changes (default border color, gradient
     class renames, `space-*` behavior) — the border-color default change can alter
     every `border-neutral-800` in place.

2. **Semantic token system.**
   - New `renderer/app/theme.css`: `@theme` block defining semantic tokens
     (`--color-background`, `--color-surface`, `--color-foreground`, `--color-muted`,
     `--color-border`, `--color-accent` [emerald/teal] + `--color-accent-foreground`,
     plus state colors, radius, focus-ring) and `:root` (light) / `.dark` (dark) value
     blocks. Tokens are the only color source; feature code uses `bg-background`,
     `text-foreground`, `text-muted`, `border`, `bg-accent`, etc.
   - Token-ize the editor styles in `index.css`: `.notes-editor`, `.note-user`,
     `.note-ai`, `.source-link` currently hard-code hex. `.note-ai`'s dimmed color
     (`#8b97a6`) is the **known AA risk** in light mode — pick a token shade that
     passes AA on both backgrounds (verified in block 08).

3. **Light / dark / system modes.**
   - A persisted `theme_mode` setting (`'light' | 'dark' | 'system'`, default `system`).
   - Main process drives `nativeTheme.themeSource` from the mode and sets the
     `BrowserWindow.backgroundColor` to the effective theme (replacing the hard-coded
     `#0b0e12`).
   - Renderer hook applies/removes `.dark` on `<html>` and reacts to system changes
     while in `system` mode.
   - Settings UI gains a theme switcher (mode field added to `SettingsView`).

## Key decisions & caveats
- **FOUC must be solved pre-paint.** The renderer is sandboxed and reads settings via
  async IPC, so resolving the theme through `window.api` flashes. Solve it
  synchronously: main sets `nativeTheme.themeSource` from the persisted mode at
  `whenReady` (before the window loads), and an inline `<script>` at the top of
  `index.html` sets `document.documentElement.classList` from a synchronously available
  value *before* React mounts. **Preferred source:** `prefers-color-scheme` (which now
  reflects `themeSource`) plus a small mirrored hint persisted on each change, so an
  explicit light/dark choice survives. Acceptable alternative: one sanctioned one-shot
  `sendSync('theme:bootstrap')` exposed only as a bootstrap value in preload (a
  documented exception to "no sync IPC"). Pick one and document it.
- **CSP is unchanged.** Tailwind v4 emits a static CSS file; inline styles are already
  permitted. No `font-src`/`script-src` change.
- **Overlay color follows theme.** Expose the effective theme so block 03 can recolor
  the `titleBarOverlay` on change.
- Keep the migration surgical — don't reformat files just to swap a class.

## Touches
`package.json` (tailwindcss@4, `@tailwindcss/postcss`, drop autoprefixer — pin
versions), `postcss.config.js`, `tailwind.config.js` (dark strategy), new
`renderer/app/theme.css`, `renderer/app/index.css` (token-ize editor styles, swap
directives), `renderer/app/App.tsx` (root color classes), `renderer/index.html`
(pre-paint script), new `renderer/features/theme/use-theme.ts` +
`theme-bootstrap.ts`, new `main/theme.ts`, `main/index.ts` (themed `backgroundColor`,
`nativeTheme` init), `main/db/settings.ts` (`theme_mode` getter/setter),
`shared/ipc-contract.ts` (new channels + `SettingsView` field), `preload/index.ts`,
new `main/ipc/theme.ts` (+ register in `ipc/index.ts`).

## IPC to add
- `theme:get` → `{ mode: 'light'|'dark'|'system'; effective: 'light'|'dark' }`
- `theme:set` → request `ThemeModeSchema = z.enum(['light','dark','system'])`; returns
  the resolved view.
- `theme:changed` → push `{ effective: 'light'|'dark' }` (fires when the system value
  flips while mode = `system`; validated in preload with the same Zod schema).
- Add a `theme` namespace to `ScribeApi` (`get`/`set`/`onChange`); fold the mode into
  `SettingsView` (additive).

## Acceptance
- App boots in `system` matching the OS; switching light/dark/system in Settings
  persists and re-applies live without reload.
- **No visible flash** on launch in either theme; window `backgroundColor` matches.
- Both themes render correctly app-wide; emerald/teal accent reads as the primary
  action color (full AA audit is block 08, spot-check here).
- `nativeTheme.themeSource` reflects the chosen mode.
- `pnpm typecheck/lint/test/build` green; production CSP unchanged.

## Out of scope
Per-feature theme variants, custom user palettes, high-contrast mode beyond AA (block
08 verifies AA only), and any brand webfont (block 09 decides; default is none).
