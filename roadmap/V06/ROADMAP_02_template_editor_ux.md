# ROADMAP_02 — Template Editor UX

**Type:** UI + IPC · **Risk:** low · **Depends on:** block 01 (instruction-slot model).

## Problem

The template create/edit experience is cramped and unguided:
- The editor dialog is `max-w-2xl` and the instructions `<Textarea>` is a fixed
  `min-h-[18rem] resize-y` — long guidance pushes the dialog around and there is no
  reliable internal scroll.
- Creating a new template starts from a blank box; nothing shows the user the house style
  (sectioned guidance, the "Not discussed" honesty rule, owner + due-date action items).
- There are no authoring aids — no way to drop in common guidance, and no help turning a
  rough idea into a well-structured prompt.

Files: `scribe/src/renderer/features/templates/TemplateEditorModal.tsx` and the Templates
section of `scribe/src/renderer/features/settings/SettingsModal.tsx` (lines ~454–499).

## Changes

### 1. Bigger, scrollable editor

In `TemplateEditorModal.tsx`:
- Widen `DialogContent` from `max-w-2xl` toward `max-w-3xl`/`max-w-4xl`; make it a
  flex-column with `max-h-[85vh]` and `overflow-hidden`, matching the pattern in
  `SettingsModal.tsx` (`flex max-h-[85vh] … flex-col … overflow-hidden`).
- Put the instructions `<Textarea>` inside a scroll region: a taller `min-h`, a capped
  height, and `overflow-y-auto` so long guidance **scrolls inside the textarea** rather
  than growing the dialog past the viewport. Keep `resize-y` if it coexists with the cap.
- Keep the shadcn component vocabulary (no hand-rolled controls).

### 2. Starter example on "New"

When the editor opens for creation (`template === null`), prefill the instructions with an
**editable starter example** that models best practice — sectioned guidance, the
"only capture what was said / mark Not discussed" honesty rule, and action items with
owner + due date. Derive the wording from the `General` block of
`roadmap/V06/MEETING_TEMPLATES.md`. Present it as real editable text the user refines
(not a non-committal placeholder), since the goal is to teach the house style. Editing an
existing template still shows that template's own `instructions` unchanged.

### 3. Canned snippet buttons

A small toolbar above the textarea with buttons that **insert guidance snippets at the
cursor** (append if no selection). Each snippet is guidance text consistent with the
block-01 instruction-slot model — e.g.:
- **Action items** — "Action items: concrete next steps with an owner and a due date when
  stated or implied."
- **Decisions** — "Decisions: every decision actually made, stated unambiguously."
- **Open questions / follow-ups**
- **Checklist** — guidance to render a checkable task list for the relevant items.
- **Summary section** — "Summary: 2–4 sentences on purpose and headline outcome."

Keep the snippet text in one small constants module so it stays consistent with
`MEETING_TEMPLATES.md`. If the insert-at-cursor logic is non-trivial, extract a pure
helper (`insertAtCursor(value, selection, snippet)`) so it can be unit-tested.

### 4. "Optimize with AI" prompt rewrite

A button that takes whatever the user has typed (rough, natural-language instructions) and
rewrites it into a well-structured guidance block in the `MEETING_TEMPLATES.md` style.

- **IPC:** add a channel to `scribe/src/shared/ipc-contract.ts` — e.g.
  `templatesOptimizeInstructions: 'templates:optimizeInstructions'` — with a Zod request
  (`{ instructions: string, name?: string }`) and response (`{ instructions: string }`).
- **Handler:** in `scribe/src/main/ipc/templates.ts`, validate with the schema, then call
  a new main-process function (in the enhancer area) that prompts the LLM to produce
  *guidance-only* output (explicitly: no `emit_enhanced_notes`/`sourceSegmentIds`/block
  mechanics — that's the app's scaffold). Use the **cheap-tier model** from block 04
  (Haiku) and a short few-shot grounded on the `MEETING_TEMPLATES.md` structure.
- **UX:** show a loading state on the button; on return, **populate the textarea for the
  user to review and edit** — never auto-save and never silently overwrite without the
  user seeing the result (§1.5 spirit). Surface errors inline (fail loud in UI; §5). The
  call originates in main with the key never reaching the renderer (§1.2).

## §1 invariants

- **§1.2** — the optimize call runs in main; the API key never crosses to the renderer.
- **§1.5/§1.6** — the optimizer produces guidance only; the scaffold/contract is still
  added at enhance time by `buildSystemPrompt`. The user reviews the rewrite before it is
  saved.
- **§4** — the new channel is declared once in the shared contract with a Zod schema and
  exposed through `window.api`; no raw `ipcRenderer`.

## Tests

- Zod schema for `templates:optimizeInstructions` (request/response round-trip).
- `insertAtCursor` pure helper (if extracted): append, mid-cursor insert, replace
  selection.

## Verification

`pnpm typecheck && pnpm lint && pnpm test`. Manual: open New template → confirm the
larger dialog, the starter example, working snippet buttons, and that a long instruction
scrolls inside the textarea; type a rough instruction, click **Optimize with AI**, and
confirm a structured guidance block returns into the editor for review.
