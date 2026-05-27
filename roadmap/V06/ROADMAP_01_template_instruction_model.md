# ROADMAP_01 — Template Instruction Model

**Type:** engine + additive migration · **Risk:** low–medium · **Foundational** (block 02
depends on it; block 04 shares its scaffold).

## Problem

Two things conflated "what the user wants this meeting type to produce" with "how the LLM
must emit structured output":

1. **`buildSystemPrompt` replaces the role section with template text.** In
   `scribe/src/main/enhancer/prompt.ts` the assembly is
   `parts.push(opts.templateInstructions?.trim() || ROLE_SECTION)` — when a template has
   instructions, `ROLE_SECTION` (which carries the LLM mechanics: preserve-user-notes,
   origin `user`/`ai`, `sourceSegmentIds`, block types, the `emit_enhanced_notes` tool)
   is **dropped entirely** and the template text is expected to re-state all of it.
2. **The built-in templates were seeded as full prompts.** Migration `version: 5`
   (`scribe/src/main/db/migrations.ts`, the reseed beginning `DELETE FROM templates WHERE
   is_builtin = 1;` around lines 154–234) stores text like *"You return the result by
   calling the emit_enhanced_notes tool"* and *"For each \"ai\" block, set
   sourceSegmentIds to the [id=N] transcript markers"* in `instructions`. Users read this
   in the editor and reasonably believe they must reproduce it.

This contradicts `roadmap/V06/MEETING_TEMPLATES.md`, whose templates are deliberately
**guidance-only** ("These are instructions, not the whole prompt. Scribe's fixed
scaffolding still owns the strict-JSON output, the my-notes/AI-notes origin rules,
source-linking, and output language"). It also makes §1.6 fragile: the contract only
survives because `CONTRACT_SECTION` is appended separately, but everything *above* it is
user-replaceable.

## Goal

`instructions` becomes a **constrained guidance slot** that shapes *what* the notes
cover; the *how* (tool use, origin rules, source ids, block types, output language) is
**always** supplied by the app and is never visible to or editable by the user. Reseed
the built-ins from `MEETING_TEMPLATES.md` so they model the guidance-only house style.

## Changes

### 1. `scribe/src/main/enhancer/prompt.ts` — split the role section

Today `ROLE_SECTION` (lines ~22–30) mixes mechanics and default guidance. Split it:

- **`SCAFFOLD_SECTION` (always emitted, near the top of the prompt):** the mechanics —
  preserve the user's notes (origin `user`); add transcript-derived blocks (origin `ai`);
  set `sourceSegmentIds` from the `[id=N]` markers; the four block types; emit via the
  tool. This is app-owned and is **not** part of any template.
- **`DEFAULT_GUIDANCE`:** the "General business meeting" shaping guidance, used **only**
  when no template is selected and no global instructions apply. Source its wording from
  the `General` template in `MEETING_TEMPLATES.md`.

New assembly in `buildSystemPrompt`:

```
[SCAFFOLD_SECTION]                                  ← always
[ template guidance slot  OR  DEFAULT_GUIDANCE ]    ← guidance, never replaces scaffold
[ global instructions (advisory) ]                  ← unchanged
[ output language directive ]                        ← unchanged (§1.7)
[ style directive ]                                  ← added by block 04 (anti-AI-tell)
[CONTRACT_SECTION]                                   ← always last (§1.6), unchanged
```

Key difference from today: the template/guidance slot is **appended after** the scaffold
instead of replacing it. Bump `PROMPT_VERSION` (currently `4`) and update the assembly
comment block. `CONTRACT_SECTION` is untouched and stays last.

### 2. `scribe/src/main/db/migrations.ts` — additive migration `version: 11`

Latest migration is `version: 10`. Add `version: 11` (name e.g.
`templates-guidance-only-reseed`) that:

- `DELETE FROM templates WHERE is_builtin = 1;`
- Re-`INSERT` the built-ins with the **clean guidance-only `instructions`** from
  `roadmap/V06/MEETING_TEMPLATES.md` — no `emit_enhanced_notes`, no `sourceSegmentIds`, no
  block-type/origin mechanics. Follow the exact pattern of the existing reseed: `INSERT …
  is_builtin, created_at, updated_at`, guarded on `is_builtin`, with `language_mode`
  `'global'` (and `is_default` on `General` if that flag exists — verify the column set).
- **Never touches user templates** (`is_builtin = 0`). `meetings.template_id` references
  stay valid because the FK is `ON DELETE SET NULL` and we re-insert built-ins; if you
  prefer to preserve ids, `UPDATE` the rows in place instead of delete+insert — either is
  fine as long as user rows are untouched. Document the choice.

**Name reconciliation:** the current DB uses `General`, `Sales discovery`, `Sales
meeting`, `Sales demo`, `Internal sync`, `1:1`; `MEETING_TEMPLATES.md` writes `Sales
Demo`/`Sales Discovery`. Pick **one** casing (recommend keeping the existing
lower-cased `Sales discovery`/`Sales demo` so any UI a user already pinned by name is
undisturbed) and apply it consistently in the reseed.

### 3. `scribe/src/shared/ipc-contract.ts` — length headroom

`TemplateCreateSchema.instructions` is `.max(4000)`. The longest reseed text (Sales
Discovery, ~1.6 KB) fits comfortably, so 4000 stays. If block 02's starter example +
snippets could push a real template past it, bump to `.max(8000)` — but only if needed;
note the headroom rather than changing it speculatively.

## §1 invariants

- **§1.6** — strengthened: the JSON contract, tool use, origin rules, and
  `sourceSegmentIds` are now *structurally* unreachable by user/template text; the
  guidance slot can only add shaping guidance. Zod validation + markdown fallback
  unchanged.
- **§1.7** — output-language directive stays where it is in the assembly.
- **§7** — additive migration only; built-ins reseeded, user templates and
  `template_id` references preserved.

## Known acceptable side effect

Pre-existing **user-created** templates that were authored as full prompts (mimicking the
old built-ins) will now be appended *after* the scaffold, so their re-stated mechanics
text becomes harmless duplication of the scaffold. Output is unaffected (the contract
still holds). Only built-ins are reseeded; user templates keep their text verbatim. Call
this out in the PR description.

## Tests

- `buildSystemPrompt`: scaffold present in **every** case; with a template, the guidance
  text is **appended** (scaffold still present, not replaced); with no template,
  `DEFAULT_GUIDANCE` appears; `CONTRACT_SECTION` is always last; language directive
  placement unchanged.
- Migration v11 against a **populated** temp SQLite (existing test pattern for migrations):
  the six built-ins now carry guidance-only text (assert no `emit_enhanced_notes` /
  `sourceSegmentIds` substrings); a seeded `is_builtin = 0` row and a meeting's
  `template_id` reference both survive intact.

## Verification

`pnpm typecheck && pnpm lint && pnpm test`. Manual: open the template editor on a
built-in (block 02 not required) and confirm the visible `instructions` no longer mention
the tool or `sourceSegmentIds`; enhance a meeting with a built-in template selected and
confirm structured output + source links still work.
