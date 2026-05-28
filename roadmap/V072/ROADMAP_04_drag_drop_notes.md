# ROADMAP_04 — Drag-and-Drop Note Organization

## Problem

Two organization gestures are friction-heavy today:

1. **Reordering meetings** is impossible. The sidebar sorts by Recent or
   A-Z (`MeetingSidebar.tsx:186–200`), with no manual override.
2. **Moving a meeting to a folder** requires right-click → "Move to
   folder" → submenu (`MeetingSidebar.tsx:343–352`). Discoverable, but a
   three-click gesture for a spatial operation.

The DB already supports per-meeting folder membership (`meetings.
folder_id`, migration v9, `scribe/src/main/db/migrations.ts`) and the IPC
`meetingsSetFolder` already exists
(`scribe/src/main/ipc/organization.ts:48–51`). What's missing is the
direct-manipulation UI and a way to persist per-sort-mode manual order.

## Goal

- Drag a meeting card to **reorder** it within the current sort mode.
  Reorderings persist **per sort mode** (per the V072 planning decision):
  reordering in Recent doesn't affect A-Z, and vice versa.
- Drop a meeting card onto a **folder row** in the folder tree to move
  the meeting into that folder. Dropping onto "All notes" clears
  `folder_id` (`null`).
- Provide a keyboard alternative for both gestures so the feature
  passes V04's a11y norms.

## Non-goals

- Multi-select drag (one meeting at a time only in V072).
- Drag a meeting onto a tag chip to apply a tag (tags are a future
  block).
- Drag a folder to reorder folders or change folder nesting (folders
  are static here; "rename / new subfolder / delete" still via context
  menu).
- Drag across application windows.
- Inline editing during drag.

## Approach

### Dependency

Add `@dnd-kit/core` and `@dnd-kit/sortable` to `scribe/package.json`
dependencies. Both are small, accessible, and React-idiomatic.
Don't use `react-dnd` (heavier, HTML5 backend, harder to test).

### DB migration — `migration v12`

Add to `scribe/src/main/db/migrations.ts`:

```sql
CREATE TABLE meeting_sort_overrides (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sort_mode  TEXT    NOT NULL,                -- 'recent' | 'az'
  position   REAL    NOT NULL,                -- fractional rank, see below
  PRIMARY KEY (meeting_id, sort_mode)
);
CREATE INDEX idx_meeting_sort_overrides_mode_pos
  ON meeting_sort_overrides (sort_mode, position);
```

- `position` is a `REAL` so we can insert between any two items by
  averaging neighbours' positions — no renumbering required for most
  drags. Periodic compaction (when fractional positions get too close)
  is a future concern; ignore in V072.
- Strictly additive — populates nothing on existing rows. Meetings
  without an override row sort by the mode's natural key
  (`created_at DESC` for Recent, `LOWER(title) ASC` for A-Z).
- On meeting delete, the cascade clears the override rows.

### Sort SQL

Update the existing meeting-list query (look in
`scribe/src/main/db/meetings.ts` / `organization.ts` for the current
list query) to `LEFT JOIN meeting_sort_overrides` for the current sort
mode and order by `COALESCE(override.position, natural_rank) ASC` for
A-Z or `DESC` for Recent. Implementation note: easiest is to express
the natural rank as a deterministic value (e.g.
`-created_at` for Recent so a single `ASC` ordering works after
`COALESCE`). Settle this during implementation; the key invariant is
that meetings with no override show in natural order and meetings with
an override show in `position` order.

### IPC additions

Add to `scribe/src/shared/ipc-contract.ts`:

```
IPC.meetingsSetSortPosition        // { meetingId, sortMode, position } → { ok: true }
IPC.meetingsClearSortOverride      // { meetingId, sortMode }          → { ok: true }   (optional, for future "reset order" menu)
```

Both Zod-validated. `sortMode: z.enum(['recent', 'az'])`.

The existing `IPC.meetingsSetFolder` is reused for the drop-onto-folder
gesture — no new channel needed.

### Renderer wiring

- Wrap the meeting list `<ul>` in `MeetingSidebar.tsx:202–244` in a
  `<DndContext>` + `<SortableContext>` from `@dnd-kit`.
- Make each `MeetingRow` a `useSortable` item. Use the **whole row** as
  the drag handle in compact mode; in extended mode, add a small grip
  handle on the left (next to the status dot) that activates the drag
  — this avoids competing with the row's click-to-open behaviour. (Read
  block 05 if it lands first to coordinate the density gate.)
- Make each `FolderTree` row a droppable target via `useDroppable`.
  Highlight on `isOver`.
- On drag end:
  - If dropped on another meeting row → compute new `position` (midway
    between neighbours' positions or natural ranks) and call
    `IPC.meetingsSetSortPosition`.
  - If dropped on a folder row → call `IPC.meetingsSetFolder` with the
    target folder ID (or `null` for "All notes").
  - Otherwise (dropped on nothing valid) → no-op, animate back.
- After IPC resolves, re-fetch the meeting list (the same path used
  today after a folder change).

### Drag preview

Use `DragOverlay` to render a styled-down copy of the row (title only,
with a subtle shadow and ~80% opacity) instead of the default browser
drag image. Reuse `MeetingRow`'s presentational pieces so styling stays
consistent across density modes.

### Keyboard alternative (a11y)

`@dnd-kit` ships a `KeyboardSensor` that announces drag start, target
changes, and drop via `live` ARIA regions. Wire it; verify with a
screen-reader pass that:

- Focusing a row + pressing Space starts a drag.
- Arrow keys move the row up/down in the list (announces "moved to
  position X of Y").
- Tab moves the drag target onto folder rows (announces "over folder
  Foo").
- Space drops; Escape cancels.

Move-to-folder via right-click → "Move to folder" stays in place as a
fallback for users on assistive tech who prefer it.

### Conflict with row click

Use `@dnd-kit`'s `activationConstraint: { distance: 4 }` (or similar) so
a small click doesn't start a drag — only after the pointer moves 4+
pixels. Falls through to the existing row-click → open-meeting handler.

### State that survives the drag

After IPC resolves, re-fetching the meeting list re-renders the
sidebar. The `useSortable` items pick up the new order on the next
render. No optimistic UI in V072 — the drag is fast enough; a
flicker-free optimistic update is a future polish.

## Verification

### Functional

1. **Reorder in Recent.** Drag a meeting up by 3 positions in Recent
   sort — it stays there on refresh. Switch to A-Z — the same meeting
   is in its alphabetical position (override is mode-scoped).
2. **Reorder in A-Z.** Drag a meeting between two others in A-Z — it
   stays. Switch back to Recent — unchanged.
3. **Move to folder.** Drag a meeting onto a folder row — meeting
   moves; folder count updates; "All notes" view still shows it. Open
   the folder — it's there in natural sort.
4. **Move out of folder.** Drag from inside a folder onto "All notes" —
   `folder_id` is cleared.
5. **Cancel drag.** Mouse-down, drag a few pixels, press Escape — no
   change.
6. **Click-to-open.** Single click on a row still opens the meeting
   (no accidental drag).
7. **Delete cascade.** Delete a reordered meeting — its override row in
   `meeting_sort_overrides` is gone (verify with a SQLite browser).

### Keyboard

- Tab to a row → Space → Arrow Down 3 times → Space → the row moved 3
  positions down; screen reader announced each step.
- Tab to a row → Space → Tab to a folder → Space → meeting moved to
  that folder.

### Migration

- Open a DB that's at v11 (no `meeting_sort_overrides` table); start
  the app; verify v12 ran and the table exists; verify all meetings
  still render in their natural order.
- Drag, verify a row appears in `meeting_sort_overrides`.

### Type/lint/test/build gates

All four green; new unit tests in
`scribe/src/main/db/__tests__/migrations.test.ts` cover the v12
migration against a populated v11 DB.

## §1 invariants — affirmation checklist

- **§1.1 / §1.2 / §1.3.** Unaffected — UI + DB only.
- **§1.5 User notes.** Reorder does not touch notes content. Folder
  moves don't either — they only update `meetings.folder_id`.
- **§1.6 / §1.7.** Unaffected.
- **§7 Migrations only — never recreate tables.** v12 is purely
  additive (`CREATE TABLE meeting_sort_overrides`); no existing data is
  touched.

## Acceptance

- `@dnd-kit/core` + `@dnd-kit/sortable` in dependencies, pinned.
- Migration v12 lands and runs cleanly against a populated v11 DB.
- IPC channels `meetingsSetSortPosition` (and optionally
  `meetingsClearSortOverride`) added and Zod-validated.
- Meeting list supports drag-reorder per sort mode + drag-to-folder.
- Keyboard alternative works.
- Manual verification scenarios above all pass.
- One commit, directly to `main`, Conventional Commits
  (`feat(ui): drag-and-drop meeting reorder + move to folder`).
