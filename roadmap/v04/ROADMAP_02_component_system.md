# ROADMAP_02 — Component System: shadcn/ui + lucide

Replace the hand-rolled UI primitives with a real, accessible component system. Today
every modal is a copy of the `fixed inset-0 bg-black/60` pattern, dropdowns are raw
`<select>`s, buttons are bespoke each time, and "icons" are emoji/text glyphs
(`✓`, `💬`, `⇄`, `⚙`, `✕`). This block adopts **shadcn/ui** (copy-in components built on
Radix primitives — no runtime framework, accessible by default, works under the strict
CSP) and **lucide-react** icons, then refactors the existing UI onto them.

## Why
Accessibility (focus traps, ARIA, keyboard) comes for free from Radix instead of being
hand-built per modal; the look becomes consistent; and blocks 03/05/07 build on real
`Dialog`/`DropdownMenu`/`Command` primitives instead of forking the modal pattern again.

## Depends on
**01** — shadcn's CSS variables (`--background`, `--primary`, …) map onto block 01's
semantic tokens, so tokens must exist first (single source of truth for color).

## Scope

1. **Install + wire shadcn/lucide.**
   - Add `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, and the
     per-component `@radix-ui/*` packages shadcn pulls in. Pin versions; justify in the
     PR (Radix is the shadcn primitive layer; the rest are tiny utilities) per §2.
   - Add `components.json`, `lib/utils.ts` (`cn()`), and a `@/` path alias (→
     `src/renderer`) in the vite + tsconfig configs. Keep `shared/` imports working.
   - Copy in the primitives actually used: `button`, `dialog`, `dropdown-menu`,
     `select`, `tooltip`, `input`, `command` (the last for block 05). Map their token
     variables onto block 01's `@theme` tokens — do not introduce a second palette.

2. **Refactor existing UI onto it.**
   - Modals → `Dialog`: `SettingsModal`, `PrivacyNotice`, `TemplatePickerModal`,
     `TemplateEditorModal`, `AutoStartPrompt`.
   - Header controls in `App.tsx`: template `<select>` → `Select`; the
     Original/Enhanced and Transcript/Chat segmented toggles → `ToggleGroup`/`Button`;
     Export/Enhance/Start/Stop → `Button` variants.
   - Icons → lucide everywhere: `Settings`, `Plus`, `X`, `MessageSquare`, `Search`,
     `Mic`, `Square` (stop), etc., across `MeetingSidebar`, `ChatPanel`,
     `CrossChatView`, `TranscriptPanel`.

## Key decisions & caveats
- **CSP is unchanged — confirm explicitly.** Radix = bundled JS (`script-src 'self'`);
  lucide = inline `<svg>` React components (no network, no font, no `data:` image). No
  `font-src`/`script-src`/`img-src` relaxation. Verify no Radix feature pulls a remote
  asset; ensure portal roots stay inside the document (no external target).
- **Pin a `tailwind-merge` version compatible with Tailwind v4** — v4 changed some class
  syntaxes and tw-merge must understand them.
- **No second button/modal style (§5).** Refactors replace the hand-rolled pattern;
  after this block there should be no remaining `fixed inset-0 bg-black/60` modal and no
  emoji-as-icon.
- Radix `Dialog`/`DropdownMenu` use portals + focus traps — preserve the old
  Escape/overlay-click behavior, and verify they coexist with the frameless drag region
  introduced in block 03.
- The TipTap editor styles (`.notes-editor` et al.) stay hand-rolled CSS (already
  token-ized in block 01) — they are not shadcn components.

## Touches
`package.json` (lucide + cva + clsx + tailwind-merge + radix; pinned), `components.json`,
`renderer/lib/utils.ts`, new `renderer/components/ui/*`, `electron.vite.config.ts` +
`tsconfig.web.json` (`@/` alias), and refactors in `renderer/features/settings/*`,
`renderer/features/templates/*`, `renderer/features/calendar/AutoStartPrompt.tsx`,
`renderer/app/App.tsx`, `renderer/features/meetings/MeetingSidebar.tsx`,
`renderer/features/chat/*`, `renderer/features/transcript/TranscriptPanel.tsx`.

## IPC to add
None. Migration: none.

## Acceptance
- All modals, dropdowns, selects, toggles, and buttons render via shadcn; all icons via
  lucide. No remaining `fixed inset-0 bg-black/60` modal or emoji-as-icon.
- Keyboard + focus behavior on dialogs/menus is at least as good as before (Escape,
  overlay click, focus return).
- Both themes correct; production CSP unchanged.
- `pnpm typecheck/lint/test/build` green.

## Out of scope
A full component-library audit beyond what the app uses; design-token changes (owned by
01); accessibility sweep (built-in via Radix here, audited in block 08).
