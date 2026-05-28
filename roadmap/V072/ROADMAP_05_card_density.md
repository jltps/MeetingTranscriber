# ROADMAP_05 — Compact / Extended Card View

## Problem

Every meeting card in the sidebar renders at one fixed density
(`MeetingSidebar.tsx:277–378`): status dot, title, timestamp, template
name (when present), and up to three tag pills. On a busy account with
hundreds of meetings, the sidebar shows ~12 meetings at a time on a
14" laptop. Users who want to scan a long history want a denser view;
users who use templates + tags heavily prefer the current rich view.

## Goal

Add a **Compact** view mode for the meeting cards that strips each row
to a single line (status dot + title + short timestamp), letting roughly
2× as many meetings fit in the visible sidebar. The existing rich
behaviour becomes **Extended** mode and remains the default. The choice
persists across launches.

A small toggle in the sidebar header lets the user switch on demand.

## Non-goals

- Three or more density modes (just Compact + Extended in V072).
- Per-folder density overrides.
- Surfacing the toggle anywhere outside the sidebar (no command palette
  entry, no Settings panel — V072 keeps it local; adding to settings is
  a 5-line follow-up if asked).
- Animating the row-height transition (instant swap is fine).

## Approach

### Settings storage

Add a new key to `scribe/src/main/db/settings.ts` (the existing KV
table, no migration needed):

```
notes_card_view: 'extended' | 'compact'   // default 'extended'
```

Add `getNotesCardView() / setNotesCardView(v)` helpers next to the
existing pattern (`getQualityMode`/`setQualityMode`, etc.).

Expose via the existing settings IPC channels — verify the shape in
`scribe/src/shared/ipc-contract.ts` and either extend the existing
"get all settings" payload or add a small dedicated channel pair.
Prefer extending the existing payload to keep the contract small.

### Renderer state

Read `notesCardView` from settings on app boot (same code path as
`themeMode`); thread into `MeetingSidebar` via a prop or a small
context. Toggling writes back to settings.

### Header toggle

Add to the sidebar header, after the search input and the
ask-across-notes button (block 03). A small icon-only toggle group
with two items:

- `Rows3` icon → Extended mode (`aria-label="Extended view"`).
- `Rows2` icon → Compact mode (`aria-label="Compact view"`).

Use shadcn `ToggleGroup type="single" variant="outline" size="xs"`
(or `size="sm"` if `xs` doesn't fit cleanly). Right-aligned in its own
row, or inline with a label "Density:" on the left. Keep it tiny and
unobtrusive — this is a power-user knob, not a primary control.

### MeetingRow rendering

In `MeetingSidebar.tsx`'s `MeetingRow` (lines 277–378), branch on the
density mode:

- **Extended (current behaviour):**
  - Status dot + title (text-sm)
  - Timestamp (text-[11px])
  - Template name (when present)
  - Up to 3 tag pills

- **Compact (new):**
  - Single row, vertical centering.
  - Status dot + title (truncated with ellipsis) + short timestamp on
    the right (e.g. "May 28", or "2h ago" — pick during implementation
    and keep it consistent with Extended's format conventions).
  - Hide template name and tags entirely.
  - Reduce `py-2.5` to `py-1.5` (or whatever fits cleanly with the
    8-px grid). Aim for ~24 px row height vs ~44 px in Extended.

The hover-revealed delete button (`group-hover:inline-flex`) stays in
both modes; in Compact it sits inline with the title row.

### Coordination with block 04 (drag-and-drop)

If block 04 ships first or alongside:

- In Extended mode, the drag handle can be a small grip icon next to
  the status dot (doesn't interfere with the now-many-line layout).
- In Compact mode, use **whole-row drag** with the `activationConstraint:
  { distance: 4 }` (already required by block 04) so a quick click
  still opens the meeting. No separate grip icon — there's no room.

Block 04's spec already notes this coordination.

### Persistence semantics

Switching modes saves immediately; no "Apply" / "OK". Next launch
restores the saved mode. Existing meetings render in the saved mode
without re-fetching.

## Verification

### Visual

1. Default install (no override) — sidebar in Extended mode, identical
   to today.
2. Toggle to Compact — every row collapses to one line; template names
   and tag pills disappear; row height ~halves.
3. Toggle back to Extended — full rich rendering returns.
4. Close + relaunch — last-selected mode persists.
5. Hover on a Compact row — delete button still appears.
6. Click a Compact row — meeting opens.
7. Both themes — Compact rows still readable, AA contrast holds.

### Functional

- `notes_card_view` is written to the settings table on toggle (verify
  with SQLite browser).
- Read at boot; sidebar opens in the persisted mode without flicker
  (no flash of Extended before switching).
- Search + folder filtering + sort all behave identically in both
  modes.

### Type/lint/test/build gates

All four green.

## §1 invariants — affirmation checklist

- **§1.1 / §1.2 / §1.3.** Unaffected — UI + setting only.
- **§1.5 / §1.6 / §1.7.** Unaffected.
- **§7 Migrations only — never recreate tables.** No migration; the new
  key is a row in the existing KV settings table.

## Acceptance

- `notes_card_view` setting + helpers in
  `scribe/src/main/db/settings.ts`.
- Sidebar header toggle (extended / compact) wired and persisted.
- MeetingRow renders both densities cleanly.
- Manual verification scenarios pass.
- One commit, directly to `main`, Conventional Commits
  (`feat(ui): compact/extended meeting card density`).
