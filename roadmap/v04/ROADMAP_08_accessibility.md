# ROADMAP_08 — Accessibility

The dedicated accessibility sweep across the new UI. Each block builds in baseline a11y
(Radix gives focus traps and ARIA for free in block 02; reduced-motion is honored as
features land), but this block is the deliberate audit-and-fix pass that guarantees the
whole app is keyboard-operable and meets **WCAG AA contrast in both themes**.

## Why
Theming and a frameless custom shell are exactly where a11y regressions hide — a dimmed
"AI note" color that fails AA on white, an accent that fails on a light Start button, a
drag region that traps focus, a streaming chat answer that screen readers never
announce. Catch them once, systematically, after the UI has settled.

## Depends on
**01–07** (it audits them). Inline a11y is built per block; this is the sweep + the
contrast guarantee + any automated check.

## Scope

1. **Keyboard navigation.** Every flow operable with no mouse: title-bar actions and
   in-app menu, command palette, sidebar folder tree + meeting list, transcript
   (virtualized) navigation, speaker-rename inline control, chat input + citation chips,
   all dialogs.
2. **Focus.** A consistent, token-based visible focus ring everywhere; correct focus
   order; focus return on dialog/menu/palette close.
3. **Contrast (AA, both themes).** Verify every text-on-background and accent pairing in
   light **and** dark. Known risks: the dimmed `.note-ai` color, and the emerald/teal
   accent on a light Start button — settle the accent shade in block 01, verify here.
4. **Reduced motion.** `prefers-reduced-motion` disables the recording-dot pulse, the
   reconnecting spinner animation, and palette/dialog transitions (keep the *meaning*,
   drop the motion).
5. **ARIA / live regions.** Recording status and the reconnecting banner →
   `role="status"`/`aria-live="polite"`; error banners → `role="alert"`; streaming chat
   answers → `aria-live`; citation chips are real labeled buttons; folder tree uses
   tree/treeitem (or listbox) semantics.

## Key decisions & caveats
- **Frameless focus.** Verify tab order reaches title-bar actions and isn't trapped by
  the drag region.
- **Native overlay controls aren't in the DOM** — their a11y is OS-provided; document
  that and don't try to re-implement it.
- **Reduced-motion must not remove meaning** — e.g. the recording indicator stays
  clearly "on", just not animated.
- A single app-wide polite announcer (optional new `renderer/features/a11y/
  announcer.tsx`) is cleaner than scattering live regions.

## Touches
`renderer/app/theme.css` (focus-ring token/utility; AA-verified token shades),
`renderer/app/App.tsx` (status/error live regions), `renderer/features/chat/*`
(`aria-live` on streaming, labeled citation buttons), `renderer/features/transcript/
TranscriptPanel.tsx` (virtualized keyboard nav + labels), `renderer/features/meetings/
MeetingSidebar.tsx` + `renderer/features/organization/FolderTree.tsx` (tree ARIA + arrow
keys), the shadcn dialogs/menus (verify post-refactor), `use-shortcuts.ts` + palette +
onboarding (focus order + reduced motion). Optional new `renderer/features/a11y/
announcer.tsx`.

## IPC to add
None. Migration: none.

## Optional automated check
Add `eslint-plugin-jsx-a11y` to `eslint.config.mjs` and an axe-based assertion in the
existing Playwright e2e (`playwright.config.ts`) so regressions are caught in CI.

## Acceptance
- Every flow is fully operable by keyboard alone; visible focus everywhere; focus
  returns correctly from overlays.
- AA contrast verified in both themes for text and accent pairings (the two known risks
  resolved).
- `prefers-reduced-motion` respected app-wide without losing meaning.
- Live regions announce recording state, streaming answers, and errors.
- If the axe check is added, it passes with no serious violations.
- `pnpm typecheck/lint/test/build` green.

## Out of scope
Full screen-reader certification, localization of a11y copy beyond the existing PT/EN
support, and AAA contrast.
