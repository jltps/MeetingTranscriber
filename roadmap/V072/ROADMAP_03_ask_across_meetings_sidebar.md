# ROADMAP_03 — Ask-Across-Meetings in Sidebar

## Problem

The cross-meeting chat entry point lives as a 24px `icon-sm` ghost
button in the TitleBar (`scribe/src/renderer/app/TitleBar.tsx:42–54`).
It's discoverable only via hover-tooltip; new users miss it entirely.
Meanwhile the sidebar already groups every other "notes navigation"
control: search, folders, tags, the meeting list. Ask-across-meetings is
the broadest navigation gesture in the app — "find me something across
everything" — and it's hidden in the title bar instead of sitting where
the rest of the search/navigation lives.

## Goal

Move the cross-chat trigger from the TitleBar to the sidebar, placed
directly **below the Search notes input** in
`scribe/src/renderer/features/meetings/MeetingSidebar.tsx`. Style it
with the same gradient as the "Optimize with AI" button (consuming the
shared component introduced in block 02), full-width, sized coherently
with the sibling "New Note" button immediately above the search.

## Non-goals

- Changing the cross-chat keyboard shortcut (Cmd/Ctrl+Shift+A in
  `features/commands/actions.ts:98–104`) — it stays.
- Changing the `CrossChatView` component or its behaviour (it still
  takes over the main content area when active per App.tsx).
- Adding a second entry point — the TitleBar button is removed.
- Adding any per-user setting for whether the button appears.

## Approach

### Add the new button in `MeetingSidebar.tsx`

Current sidebar header (MeetingSidebar.tsx:152–172) is:

```
header
  New Note button (w-full, size="sm")
  Search notes input (Input type="search", h-8 pl-8)
```

Add a third row directly under the search input:

```
header
  New Note button (w-full)
  Search notes input
  Ask across notes button (w-full, AI-themed, size="sm")
```

JSX shape (uses the component introduced in block 02):

```jsx
<AiButton
  size="sm"
  onClick={onOpenCrossChat}
  className="w-full"
  aria-label="Ask across notes"
>
  <MessageSquare />
  Ask across notes
</AiButton>
```

If block 02 hasn't shipped yet, inline the className verbatim
(`bg-gradient-to-r from-primary to-info text-white shadow-sm
hover:opacity-90`) and refactor when 02 lands. Either ordering works.

### Sizing coherence

- Width: `w-full` to match the "New Note" button at the top.
- Height: `size="sm"` → `h-8`, identical to "New Note".
- Spacing: same vertical gap as between New Note and Search (the header
  container uses `space-y-2` or similar — verify during implementation
  and match).
- Icon: `MessageSquare` from lucide-react (same icon as today's
  TitleBar entry), default size for `size="sm"` (size-4).

### Remove the TitleBar button

In `scribe/src/renderer/app/TitleBar.tsx:42–54`, remove the
`Ask across meetings` Tooltip + Button. Keep the `onOpenCrossChat` prop
threaded through — it now drives only the sidebar button (and the
command-palette action, which calls the same handler from
`features/commands/actions.ts`). If `TitleBar`'s only consumer of
`onOpenCrossChat` was that button, drop the prop entirely and remove it
from the `TitleBar` call site in App.tsx.

### Label wording

"Ask across notes" matches the sidebar's "Search notes" wording
(both are about navigating *notes* in this app's terminology). The
existing tooltip and command-palette label say "Ask across meetings";
keep the command-palette label as-is for muscle memory, but the new
sidebar button reads "Ask across notes" for vocabulary consistency
within the sidebar. Decide during implementation if vocabulary
inconsistency between sidebar and palette is acceptable; default to
"Ask across notes" in the sidebar.

## Verification

### Visual

1. Sidebar header from top to bottom: `New Note` → `Search notes…` →
   `[✨ Ask across notes]` (gradient). All three full-width and same
   height.
2. Title bar shows only the sidebar toggle + settings cog — no
   message-square icon.
3. Click the new button → CrossChatView opens (same as the old TitleBar
   button + Cmd/Ctrl+Shift+A shortcut).
4. Cmd/Ctrl+Shift+A still opens CrossChatView from the command palette.
5. Both themes: gradient text contrast clears AA.
6. Narrow window: the button text doesn't overflow; if it does, the
   icon-only label "Ask" is acceptable but verify first.

### Functional

- The `onOpenCrossChat` callback fires; CrossChatView mounts.
- Closing CrossChatView returns to the previous main view.
- Command-palette flow unchanged.

### Type/lint/test/build gates

All four green.

## §1 invariants — affirmation checklist

- **§1.1–§1.7.** Unaffected — UI move only.

## Acceptance

- New "Ask across notes" button in the sidebar header directly below
  the search input, styled with the AI gradient, sized coherently with
  the "New Note" sibling.
- TitleBar's cross-chat icon button removed.
- Command-palette + keyboard shortcut still work.
- One commit, directly to `main`, Conventional Commits
  (`refactor(ui): move cross-chat entry from TitleBar to sidebar`).
