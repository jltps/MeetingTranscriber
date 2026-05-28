# ROADMAP_02 — Note Window Unified Header

## Problem

Controls that govern the notes column are scattered across the meeting
detail view:

- The **Original / Enhanced** toggle lives in the app-level meeting
  header (`scribe/src/renderer/app/App.tsx:725–736`), far from the notes
  it switches.
- The **Chat** trigger lives as a tab in the *right* (transcript) column
  (App.tsx:811–821), even though chat is a property of the meeting's
  notes, not its transcript. The right column is labeled "Live
  transcript" but secretly hosts a Transcript/Chat toggle — surprising.
- The Original/Enhanced toggle and the Chat trigger have no visual
  relationship to each other or to the notes pane, despite all governing
  what the user reads on the left.

The placement is incoherent: depth (Extended/Key points) lives *inside*
the notes pane (`EnhancedPane.tsx:24–35`), Original/Enhanced lives
*above* the notes pane in the global header, and Chat lives in a
*different* column entirely.

## Goal

A single unified header at the top of the note window that hosts:

- **Left side:** Original / Enhanced toggle (when enhanced notes exist),
  using the existing shadcn `ToggleGroup variant="outline" size="sm"`.
- **Right side:** a **Chat** button styled with the same gradient as the
  "Optimize with AI" button.

The right column becomes transcript-only: no more Transcript/Chat tab in
there.

Clicking Chat **replaces the notes content area** with the per-meeting
ChatPanel (mirrors how Original ↔ Enhanced swap content today). The
Original/Enhanced toggle stays visible while chat is active but is
visually de-emphasised (e.g. dimmed/disabled) — clicking it switches back
to notes. A second click on the Chat button also returns to notes.

## Non-goals

- Changing the Extended / Key-points depth toggle's location (it stays
  inside the notes content; it's a within-notes refinement, not a top-
  level view switch).
- Persisting "last viewed: chat vs notes" across meetings. Switching to
  a different meeting always lands on notes, never chat.
- Adding a third tab for transcript (the right column still hosts it
  visually).
- Reskinning Original/Enhanced as a gradient — it remains a neutral
  outline toggle. Only the Chat button gets the gradient.

## Approach

### A reusable "AI-themed" Button (foundation for blocks 02 + 03)

Add a small component `scribe/src/renderer/components/ui/ai-button.tsx`
(or extend `button.tsx` with a `variant="ai"`). It wraps the existing
shadcn `Button` with:

```
className="bg-gradient-to-r from-primary to-info text-white shadow-sm hover:opacity-90"
```

…on top of whatever `size` and extra `className` the caller passes.
Defaults to `size="sm"`. Accepts children + standard Button props.

Migrate the existing "Optimize with AI" button in
`scribe/src/renderer/features/templates/TemplateEditorModal.tsx:172–184`
to use this component (single-line change). Block 03 (sidebar
ask-across button) consumes the same component.

If `variant="ai"` in `button.tsx` is cleaner than a separate component,
use that path — verify which fits the existing variant style during
implementation.

### Note window header — new component

`scribe/src/renderer/features/notes/NoteWindowHeader.tsx` (new). Props:

```
type Props = {
  hasEnhanced: boolean;
  view: 'original' | 'enhanced' | 'chat';
  onViewChange: (v: 'original' | 'enhanced' | 'chat') => void;
};
```

Layout: `flex items-center justify-between mb-3`:

- **Left:** `ToggleGroup type="single" variant="outline" size="sm"` with
  Original / Enhanced items, mirroring App.tsx:725–736. When `view ===
  'chat'`, render the toggle disabled (`data-disabled` or `disabled` on
  each item) so the user sees the current notes mode but knows chat is
  taking over. Hide entirely when `!hasEnhanced` (matches today).
- **Right:** the new AI-themed Button with `MessageSquare` icon and label
  "Chat". When `view === 'chat'`, render it as visually pressed (e.g.
  via an `aria-pressed="true"` + slightly darker gradient) and the label
  becomes "Back to notes" — clicking returns to the previous notes
  view (`'original'` or `'enhanced'`, whichever was selected before
  chat).

### Wire into `App.tsx`

- Lift the `view` state currently at App.tsx:94 to include `'chat'` as a
  third value, OR introduce a parallel `noteSurface: 'notes' | 'chat'`
  state alongside the existing `view: 'original' | 'enhanced'`. The
  latter is cleaner — the existing `view` keeps its existing semantics,
  and `noteSurface` decides whether to render the notes editor or the
  chat panel inside the left column. Decide during implementation by
  reading App.tsx state shape.
- Replace the inline Original/Enhanced toggle at App.tsx:725–736 with
  `<NoteWindowHeader … />` rendered **inside** the left
  `ResizablePanel` (App.tsx:805–808), above `renderNotes()` and the
  scrollable container. The header is sticky to the top of the left
  panel (`sticky top-0 z-10 bg-background`) so it stays visible as the
  user scrolls long notes.
- Remove the right-column Transcript/Chat ToggleGroup at App.tsx:
  811–821. The right column now renders only `<TranscriptPanel />` and
  no top toggle — match the existing `flex flex-col` structure but
  drop the toggle row.
- In the left panel render, when `noteSurface === 'chat'`, render
  `<ChatPanel … />` (currently at App.tsx:824) in place of
  `renderNotes()`. ChatPanel already exists at
  `features/chat/ChatPanel.tsx`; reuse as-is (its header "Ask this
  meeting" stays).

### Empty-state behaviour

If `hasEnhanced === false`, the left side of the new header shows
nothing (no toggle), and the Chat button alone sits flush right.
ChatPanel availability is independent of enhancement existence —
chat is keyed to the meeting, not to the enhanced notes (matches
current behaviour at App.tsx:824).

### Keyboard / a11y

- Tab order: ToggleGroup items → Chat button.
- Chat button has `aria-pressed={view === 'chat'}` and an accessible
  label that includes the current state ("Chat" or "Back to notes").
- Disabling the ToggleGroup in chat mode uses real `disabled` so screen
  readers announce it correctly; not just `opacity-50`.

## Verification

### Visual

1. Open a meeting with enhanced notes — header shows
   `[Original | Enhanced]` on the left and `[✨ Chat]` (gradient) on the
   right.
2. Click Enhanced → notes content swaps; toggle moves; right column
   still shows transcript only (no tabs).
3. Click Chat → notes content area swaps to chat; ToggleGroup dims;
   Chat button is pressed and reads "Back to notes".
4. Click "Back to notes" → returns to whichever notes mode was selected
   before chat.
5. Open a meeting with no enhanced notes — header shows only the Chat
   button, no Original/Enhanced toggle.
6. Resize the window narrow — the header still fits; the gradient
   button doesn't wrap awkwardly.
7. Light + dark themes — gradient still hits AA contrast on its
   labelled text.

### Functional

- Existing Original/Enhanced behaviour from App.tsx:94 + the
  `renderNotes()` switch keeps working unchanged.
- Existing ChatPanel behaviour from App.tsx:824 keeps working unchanged
  (just rendered in a different column).
- The Extended / Key-points toggle inside `EnhancedPane.tsx:24–35`
  remains in place, untouched.
- "Optimize with AI" still renders in the template editor unchanged
  visually (after migrating to the new component).

### Type/lint/test/build gates

`corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test &&
corepack pnpm build` all clean.

## §1 invariants — affirmation checklist

- **§1.1 / §1.2 / §1.3 / §1.4 / §1.6 / §1.7.** Unaffected — UI move only.
- **§1.5 User notes.** Chat does not edit notes; ChatPanel today reads
  meeting state without writing to `notes.body_md`. Behaviour unchanged.

## Acceptance

- `scribe/src/renderer/components/ui/ai-button.tsx` (or `button.tsx`
  variant) lands and the Optimize-with-AI button migrates to it.
- `scribe/src/renderer/features/notes/NoteWindowHeader.tsx` ships and
  is mounted inside the left `ResizablePanel` in App.tsx.
- The right column's Transcript/Chat toggle is removed; right column
  shows transcript only.
- Manual verification above passes in both themes.
- One commit, directly to `main`, Conventional Commits
  (`refactor(ui): unify Original/Enhanced and Chat controls in note header`).
