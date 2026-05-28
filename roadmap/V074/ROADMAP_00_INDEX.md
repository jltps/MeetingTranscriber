# ROADMAP_00_INDEX.md

> **Status: in flight.** Plan approved 2026-05-28; commits land directly
> on `main` per CLAUDE.md §10 and memory `commit-to-main`. Promote to
> "shipped in v0.7.4" once the cross-cutting verification below is green.

The **V074 backlog — UI polish pass.** V07/V072/V073 finished the
under-the-hood reliability work (auto-update, drag-reorder, capture
fallbacks, bleed-aware "Me"). V074 turns the lens back on the surface the
user actually touches every day and sands off six concrete friction
points raised after a week of dogfooding:

1. **The AI buttons (Ask-across-notes, Chat, Optimize-with-AI) compete
   with the primary CTAs.** Solid teal "default" + bold teal→blue
   gradient "ai" carry roughly equal weight, so the eye doesn't land on
   **New Note** or **Start** first. The gradient should read as a tinted
   accent, not a third CTA tier.
2. **Settings is one 700-line vertical scroll** mixing API keys, audio
   devices, templates, cost telemetry, calendar accounts, updates, and a
   destructive "wipe data" button. There is no grouping and no
   navigation — every change requires hunting through the whole modal.
3. **Templates are one of the strongest features** but they live as a
   list + a stacked sub-modal hidden inside that scroll. They deserve a
   real authoring surface (full-screen overlay).
4. **The left sidebar is fixed.** Sections appear in a hardcoded order,
   the user can't hide what they don't use, and density/sort live in a
   header that won't move. New Note / Search / Ask-across-notes should
   be pinned; the rest (Folders, Tags, Agenda, Notes) should be
   reorderable, hidable, and resizable via a discoverable Edit mode.
5. **About Nexus** exposes "Releases" and "Source" buttons that open the
   public GitHub repo. The V07 auto-updater made the first redundant;
   the second leaks the repo into the product UI. Both go.
6. **"Wipe all local data" is gated by a single `window.confirm()`.**
   Given it deletes every meeting, transcript, note, template, key, and
   row, a typed second confirmation is warranted.

> **Hold the §1 invariants.** V074 is entirely renderer work. No audio
> bytes ever exist (§1.1), no key plaintext crosses the bridge (§1.2),
> the renderer stays sandboxed (§1.3), no platform integrations are
> added (§1.4), notes are untouched (§1.5), the JSON enhancer contract
> is unchanged (§1.6), and language behaviour is unchanged (§1.7). The
> only persistence touched is the existing KV `app_settings` table —
> two new string keys (`sidebar_layout`, `settings_last_tab`), no
> migration.

## The blocks

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | Soften AI button variant | Recolour `variant="ai"` from bold gradient + white text to soft-tinted gradient + primary text/icon | Renderer UI |
| 02 | Sidebar Edit mode + scrollable sections | Pin top actions; persist `{order, hidden, sizes}` for Folders/Tags/Agenda/Notes; Edit mode panel with checkbox + drag handle; per-section scroll | Renderer UI + KV persistence |
| 03 | Settings vertical-tab restructure | Replace single-scroll Settings modal with left-rail vertical tabs (General / AI / Audio / Transcription / Calendar / Templates / Updates / Usage / Data / Privacy); persist last-tab | Renderer UI + KV persistence |
| 04 | Templates full-screen page | Extract `TemplateEditor` from the stacked dialog into a top-level full-screen page with list-on-left, editor-on-right; route from Settings → Templates | Renderer UI |
| 05 | About dialog cleanup | Remove Releases + Source buttons from `AboutDialog`; keep "Check for updates" | Renderer UI |
| 06 | Double-confirm wipe data | Replace `window.confirm()` with a typed-"WIPE" Dialog | Renderer UI |

## Dependencies

```
01 AI button     ── independent; one-line change to button.tsx, cascades to call sites.
02 Sidebar       ── independent of 03/04; the new KV layout key is read in MeetingSidebar only.
03 Settings tabs ── independent of 02; pure JSX restructure inside SettingsModal.
04 Templates     ──► consumes 03 (the new Settings → Templates tab is the entry point) but
                    the page itself can land first as a standalone route.
05 About         ── independent; ~6 lines removed from AboutDialog.
06 Wipe          ──► lives inside SettingsModal so coordinate with 03 (the Privacy tab
                    is where the button moves). Implement after 03.
```

## Suggested order

1. **05 About cleanup** — smallest, lowest risk, warms the working tree.
2. **01 AI button variant** — one-line edit, validates the soft-tint
   token combination before any of the larger UI work depends on it.
3. **06 Wipe data dialog** — small, self-contained Dialog; lets 03 ship
   with the new typed-confirm already wired into the Privacy section.
4. **03 Settings vertical tabs** — restructures the file every other
   Settings change has to touch.
5. **04 Templates full-screen page** — depends on 03's "Manage
   templates" tab being the entry point.
6. **02 Sidebar Edit mode + scrollable sections** — biggest UI change,
   independent of the others; lands last so any regression caught in
   smoke testing is attributable to one block.

## Cross-cutting notes (hold across every block)

- **No DB migration.** The new keys live in the existing KV
  `app_settings` table (`main/db/settings.ts`), same path `notes_card_view`
  uses. If a key is missing on read, the renderer falls back to the
  default layout / first tab.
- **No new dependencies.** `@dnd-kit/sortable`, `react-resizable-panels`,
  Radix `Tabs`, and shadcn primitives are all already in `package.json`.
- **No new IPC channels.** Reuse the existing `settings:getKv` /
  `settings:setKv` channels (or whichever names the contract already
  ships — confirm during impl). The new KV keys are application-level,
  not contract-level.
- **Type/lint/test/build green at every commit** per CLAUDE.md §10/§11.
- **No §1 invariant moves.** V074 is pure UI; the only behaviour change
  on the wire is the typed-confirm gate on `settings.wipe()`.

## How to use a block with Claude Code

Feed the block file plus the codebase. Same discipline as V07/V072/V073:
read the existing code, propose the fit before writing, ship as its own
commit to `main`, hold the §1 invariants, and keep
`corepack pnpm typecheck/lint/test/build` green. Verify each block in a
`corepack pnpm dev` run in both light and dark theme before declaring
done — V074 is entirely UI, so screenshots-from-real-app beat unit
tests for these blocks.
