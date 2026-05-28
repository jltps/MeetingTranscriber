# V074 — Block 02 — Sidebar Edit mode + scrollable sections

## Why

The left sidebar (`MeetingSidebar.tsx`) renders a hardcoded vertical
stack: top actions → folders → tags → agenda → notes list. The user
can't hide what they don't use, can't reorder, and only the notes list
scrolls — if Folders or Tags grow long, they push everything below
out of view. The Notes header (density + sort) is locked in place
between Agenda and the list.

The user asked for: pinned top actions (New Note, Search,
Ask-across-notes), a discoverable Edit mode that lets every other
section be hidden, reordered, and resized, and every long list
scrollable inside its own section.

## What

### Layout state

A single JSON blob in the existing KV `app_settings` table (key
`sidebar_layout`, written through the existing `settings:setKv` /
`settings:getKv` channels — no new IPC, no migration):

```ts
type SidebarSection = 'folders' | 'tags' | 'agenda' | 'notes';

type SidebarLayout = {
  order: SidebarSection[];                            // top→bottom
  hidden: SidebarSection[];                           // toggled off
  sizes: Partial<Record<SidebarSection, number>>;     // px height
};

const DEFAULT_LAYOUT: SidebarLayout = {
  order: ['folders', 'tags', 'agenda', 'notes'],
  hidden: [],
  sizes: {},
};
```

A new hook `renderer/features/layout/use-sidebar-layout.ts` exposes
`{ layout, setOrder, toggleHidden, setSize, reset }`, hydrates from KV
on mount, persists writes (debounced for resize).

### Rendering

`MeetingSidebar` is split:

```
<aside>
  <TopActions />          // pinned: New Note, Search, Ask-across-notes
  {editing
    ? <EditSidebarPanel />
    : <SectionStack layout={layout}>
        <FoldersSection />
        <TagsSection />
        <AgendaSection />
        <NotesSection />
      </SectionStack>}
  <EditSidebarButton onClick={() => setEditing(true)} />
</aside>
```

- `TopActions` always renders first. Not part of `order`. Cannot be
  hidden.
- `SectionStack` walks `layout.order`, skips hidden ids, renders each
  matching child in a wrapper that applies the persisted size + an
  `overflow-y-auto` so contents scroll inside the section.
- `NotesSection` keeps `flex-1` so it always claims remaining space;
  the other sections take `sizes[id] ?? defaults[id]` (Folders/Tags
  default 12rem, Agenda auto). Notes ignores `sizes` (no manual height
  — it always fills).
- Inter-section resize: a thin draggable separator between consecutive
  visible sections updates `sizes[<above>]`. Simple custom drag (no
  need for `react-resizable-panels` here — single-axis vertical resize
  inside a sidebar is ~30 lines and avoids pulling that lib into the
  sidebar tree, which is otherwise just dnd-kit).

### Edit mode

A bottom-of-sidebar `Button variant="ghost" size="xs"` with a
`SlidersHorizontal` icon swaps the section stack for
`EditSidebarPanel` (inline replacement — not a modal):

- One row per section, in `layout.order`. Each row has:
  - Checkbox bound to `hidden` (disabled on the last visible section so
    the user can't lock themselves out of every section).
  - `⠿` drag handle wired through `@dnd-kit/sortable`
    (`SortableContext` + `useSortable` — already imported by
    `MeetingSidebar` for meeting row drag). Drop reorders `layout.order`.
- "Reset layout" link at the bottom restores `DEFAULT_LAYOUT`.
- "Done" returns to the normal stack.

### Files

- `scribe/src/renderer/features/meetings/MeetingSidebar.tsx` — split
  the body; keep all existing meeting-row drag/sort behaviour intact
  (it's now scoped to the NotesSection's `DndContext`).
- New: `scribe/src/renderer/features/layout/use-sidebar-layout.ts`.
- New: `scribe/src/renderer/features/layout/SidebarLayout.tsx` — exports
  `SectionStack`, `EditSidebarPanel`, `EditSidebarButton`.
- New: `scribe/src/renderer/features/layout/sidebar-sections.tsx` — the
  four section components (`FoldersSection`, `TagsSection`, `AgendaSection`,
  `NotesSection`) extracted from `MeetingSidebar`.

## Hold the invariants

No new IPC channel, no new schema, no audio/network change. Pure
renderer + one new KV key.

## Verify

`pnpm dev`:

- Reorder Folders below Notes → reload app → still reordered.
- Hide Tags → reload → still hidden; checkbox restores it.
- Drag separator between Folders and Tags → both respect new heights,
  contents scroll inside.
- Drag-reorder a meeting row inside Notes — V072 behaviour still works.
- Last visible section's hide checkbox is disabled.
