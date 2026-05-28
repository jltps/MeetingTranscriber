# V074 — Block 01 — Soften the AI button variant

## Why

Today the `variant="ai"` button (used by Ask-across-notes in the sidebar,
Chat in `NoteWindowHeader`, and Optimize-with-AI in the template editor)
renders as a bold teal→blue gradient with white text. The solid teal
`variant="default"` (New Note, Start) carries roughly the same visual
weight, so the eye doesn't land on the primary CTA first. The AI accent
should be a tinted secondary, not a CTA.

## What

One-line edit to `scribe/src/renderer/components/ui/button.tsx`. Replace:

```ts
ai: "bg-gradient-to-r from-primary to-info text-white shadow-sm hover:opacity-90",
```

with a soft-tinted variant:

```ts
ai: "bg-gradient-to-r from-primary/10 to-info/10 text-primary hover:from-primary/20 hover:to-info/20",
```

- Background opacity 10 % so the gradient is visible but not loud.
- Text + icon inherit `text-primary` so the brand teal still signals
  "this is an AI thing".
- Hover doubles the tint (20 %) instead of fading via `opacity-90`,
  which would have washed the soft fill out further.
- Drop `shadow-sm` — the solid-gradient variant needed the shadow to
  separate from the page; the tinted version sits flat with the
  surrounding card.
- Keep `bg-gradient-to-r` so the variant is still recognisable.

Both `--primary` and `--info` tokens already exist in
`renderer/app/index.css` for both themes; the same classes work in dark.

No call-site changes — all three consumers (`MeetingSidebar.tsx`,
`NoteWindowHeader.tsx`, `TemplateEditorModal.tsx`) inherit the new look.

## Verify

`pnpm dev` in light and dark theme:

- New Note and Start are now visually dominant.
- Ask-across-notes, Chat, and Optimize-with-AI render as soft tinted
  buttons with teal label + icon.
- Focus ring + disabled state still work (inherited from the cva base).
