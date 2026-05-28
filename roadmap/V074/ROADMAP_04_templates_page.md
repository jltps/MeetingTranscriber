# V074 — Block 04 — Templates as a full-screen page

## Why

Templates are one of the strongest features (V06 reworked them into a
guidance-slot system, V06 added Optimize-with-AI), but the authoring UI
lives as a sub-Dialog stacked on top of the Settings Dialog. Selecting
a template, switching to another, or scanning the list against the
editor means closing one modal and reopening another. They deserve a
real workspace.

## What

A top-level full-screen page that replaces the meetings layout while
active, matching the previewed layout:

```
┌──────────────────────────────────────────────────────────┐
│  ← Back              Templates                  [+ New]  │
├────────────┬─────────────────────────────────────────────┤
│ Default    │  Name: [….............]                     │
│ Standup ▸ │  Language: [Auto ▾]                          │
│ Sales      │ ┌──────────────────────────────────────────┐│
│ 1:1        │ │ + Action │ + Decisions │ + Summary       ││
│ Interview  │ ├──────────────────────────────────────────┤│
│            │ │ Instructions here…                       ││
│            │ │                                          ││
│            │ └──────────────────────────────────────────┘│
│            │       [✨ Optimize with AI]                  │
│            │                          [Cancel] [Save]    │
└────────────┴─────────────────────────────────────────────┘
```

### Files

- Refactor: `scribe/src/renderer/features/templates/TemplateEditorModal.tsx`
  — extract the body (name, language mode, snippet toolbar, textarea,
  Optimize-with-AI, Save/Cancel) into a reusable
  `<TemplateEditor template={…} onSave={…} onCancel={…} />` component.
  The Dialog wrapper can stay as a thin shell for any remaining legacy
  callers, but the V074 page renders the editor directly.
- New: `scribe/src/renderer/features/templates/TemplatesPage.tsx` — the
  full-screen layout. Left column is a scrollable list of template
  rows reusing the existing pattern from `SettingsModal`. "+ New"
  creates a new template prefilled with `STARTER_INSTRUCTIONS` (kept in
  unsaved state until Save). Right column renders `<TemplateEditor>`
  with `min-h-[60vh]` on the textarea since we have the room.
- Edit: `scribe/src/renderer/app/App.tsx` — add a top-level state
  `appView: 'meetings' | 'templates'`. When `'templates'`, render
  `<TemplatesPage onBack={() => setAppView('meetings')} />` in place of
  the meetings layout.
- Edit (V074 Block 03): the Settings → Templates tab is a single
  "Manage templates" button that calls `setAppView('templates')` and
  closes Settings.

### IPC

None new — reuse `templates:create`, `templates:update`,
`templates:delete`, `templates:optimizeInstructions`.

## Hold the invariants

§1.6 — the template editor only edits the `instructions` guidance slot,
never the JSON contract scaffolding in `main/enhancer/prompt.ts`.
Optimize-with-AI still goes through the main-side
`optimize-template.ts` flow.

## Verify

`pnpm dev`:

- Settings → Templates → "Manage templates" opens the full-screen page;
  Settings closes.
- Left list shows existing templates; selecting one loads it into the
  right editor.
- "+ New" produces an unsaved template with starter instructions; Save
  adds it to the list; Cancel discards it.
- Optimize-with-AI rewrites the instructions in place.
- Delete removes the template; selection falls back to the first row.
- Back returns to the meetings view; selected meeting still selected.
