# ROADMAP_00_INDEX.md

> **Status: shipped in v0.7.2.** All seven blocks below (plus a mid-stream tags-
> sidebar fix and an expanded block-02 scope that pulled Folder/Tags/Export into
> the new unified header) are merged to `main`. See `README.md` and `CLAUDE.md`
> for the shipped summary; these per-block files now serve as historical
> reference for *what* was built and *why*.

The **V072 backlog — Minor Experience Tweaks.** V04 shipped the UI/UX
rebrand + design tokens + folders/tags + command palette; V06 added the
templates editor, summary depths, and the "Optimize with AI" gradient
button. V072 is six small UX refinements that have accumulated from daily
use — none are individually large, but together they sand off rough edges
across the sidebar, the meeting detail view, the agenda, and first launch.

The blocks are deliberately independent so they can ship one at a time and
land in any order (with two small ordering preferences noted in the
dependencies section below).

> **Hold the §1 invariants.** Every block is UI/UX-only — none touches
> audio (§1.1), API keys (§1.2), the strict-JSON enhancement contract
> (§1.6), or language behavior (§1.7). Block 04 (drag-and-drop) ships one
> additive DB migration; block 05 (card density) adds a settings key; the
> other four block ship no schema or contract changes.

## The blocks

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | Launch Screen | Brief splash on app start so the user sees Nexus immediately instead of a blank/late-painting window | Main + renderer startup |
| 02 | Note Window Unified Header | Move Original/Enhanced toggle and Chat trigger into the note window's own header; theme Chat with the Optimize-with-AI gradient; right column becomes transcript-only | UI |
| 03 | Ask-Across-Meetings in Sidebar | Move the cross-chat entry point from the TitleBar to the sidebar (below Search notes); full-width, gradient-themed like Optimize with AI; sizing coherent with neighbouring sidebar buttons | UI |
| 04 | Drag-and-Drop Note Organization | Drag a meeting card to reorder it (per sort mode) or drop it onto a folder row to move it; introduces `@dnd-kit` and an additive migration | UI + DB migration |
| 05 | Compact / Extended Card View | New "Compact" vs "Extended" density for meeting cards in the sidebar; persisted as a settings key; small toggle in the sidebar header | UI + settings |
| 06 | Date on Calendar Events | Show the date (Today / Tomorrow / weekday / explicit date) alongside the time on every agenda row | UI |

## Dependencies

```
Independent unless noted:

02 Note window header ─┬─► (shares button styling with) 03 Ask-across in sidebar
                       │   Both use the Optimize-with-AI gradient pattern;
                       │   either can land first. Whichever ships first
                       │   establishes the shared button styling.
                       │
04 Drag-and-drop ──────┘  Adds the `@dnd-kit` dep; touches the same MeetingRow
                          component as block 05.

05 Card density ── independent; touches MeetingRow alongside 04. If 04 lands
       first, 05's density-switch needs to keep the drag handle reachable
       (or use whole-row drag) in compact mode. Easy to handle; called out
       in block 05's spec.

01 Launch screen, 06 Calendar date ── fully independent of the others.
```

## Suggested order

1. **01 Launch Screen** — small, isolated, makes every other change feel
   snappier because the app paints quickly.
2. **02 Note Window Unified Header** — establishes the gradient button
   styling that 03 reuses.
3. **03 Ask-Across-Meetings in Sidebar** — reuses 02's button pattern.
4. **06 Calendar Date** — trivial, can land in parallel any time.
5. **05 Compact / Extended Card View** — first density-aware change to the
   sidebar.
6. **04 Drag-and-Drop** — last because it's the largest block (new
   dependency + DB migration) and benefits from landing on top of 05's
   density-aware card layout.

## Cross-cutting notes (hold across every block)

- **One shared gradient button styling.** Blocks 02 and 03 both want the
  Optimize-with-AI look:
  `className="bg-gradient-to-r from-primary to-info text-white shadow-sm hover:opacity-90"`
  on a `size="sm"` shadcn `Button` with a lucide icon
  (`templates/TemplateEditorModal.tsx:172–184`). Whichever block lands first
  should extract that into a reusable component or a `Button` variant — see
  block 02's "Reusable AI button" note. The other block consumes it.
- **No new icons beyond lucide-react.** Every block uses existing lucide
  icons; no new image assets except block 01's splash, which reuses
  `scribe/src/renderer/assets/logo.svg` and `scribe/build/icon.png`.
- **Settings storage.** Only block 05 adds a key (`notes_card_view`) to
  the existing `settings` KV table (`scribe/src/main/db/settings.ts`); no
  migration needed for that. Block 04 ships migration **v12** for the new
  per-sort-mode reorder overrides table.
- **No IPC contract churn except block 04.** Blocks 01/02/03/05/06 are
  pure renderer changes; block 04 adds `IPC.meetingsSetSortPosition` (or
  similar — name during implementation). All other channels unchanged.
- **Accessibility.** V04's a11y norms hold: keyboard reachability, focus
  rings, AA contrast in both themes, `prefers-reduced-motion`. Block 04
  in particular must keep a keyboard alternative for reorder + move-to-
  folder (the existing right-click context menu already covers move-to-
  folder; reorder via keyboard needs a small spec — see block 04).
- **Type/lint/test/build green at every commit** per CLAUDE.md §10. Each
  block ships as its own commit to `main`, Conventional Commits.

## How to use a block with Claude Code

Feed the block file plus the codebase. Same discipline as V06/V07: read
the existing code, propose the fit before writing, ship as its own commit
to `main` (per CLAUDE.md §10 + memory `commit-to-main`), hold the §1
invariants, and keep `corepack pnpm typecheck/lint/test/build` green.
Verify each block visually in a `corepack pnpm dev` run before declaring
done; block 01 also needs a packaged-build verification.
