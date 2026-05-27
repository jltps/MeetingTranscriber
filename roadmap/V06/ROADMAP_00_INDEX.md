# ROADMAP_00_INDEX.md

The **V06 backlog — Templates & AI Capabilities.** v1→v5 shipped capture,
transcription, enhancement, organization, the UI/UX rebrand, and the transcription
quality/cost phase. V06 turns back to the **enhancement / LLM layer** and the
**template authoring experience** to fix concrete problems seen in daily use:

1. **Templates leak app scaffolding.** The six built-in templates were seeded with the
   *full system prompt* as their `instructions` — LLM-mechanics text like *"You return
   the result by calling the emit_enhanced_notes tool"* and *"set sourceSegmentIds to the
   [id=N] markers"*. Users see and are expected to maintain this when authoring a
   template. That mechanics text is the **app's** job, not the user's
   (`roadmap/V06/MEETING_TEMPLATES.md` is written as guidance-only for exactly this
   reason).
2. **Template authoring is cramped and unguided** — a small editor, no starter example,
   no authoring aids.
3. **Enhanced notes have one depth.** Users want a **key-points** view and an
   **extended** view of the same meeting.
4. **AI is mono-model and uncached.** All three callers hardcode `claude-sonnet-4-6`;
   there is no cost tiering, no prompt caching on the enhance path, and Anthropic is the
   only provider.
5. **Output polish.** AI titles are too long; AI prose carries tells (em-dashes etc.).
6. **UI clutter.** The meeting header carries a cost chip; the Settings dialog is small.

Like v03/v04/v05, each block has its own file and can be specced into Claude Code on its
own branch. This index explains the grouping, the dependencies, and the suggested order.

> **These blocks touch the §1.6 JSON-contract invariant and the §8 LLM rules — the
> highest-care non-audio area of the app.** Hold the §1 invariants exactly:
> **§1.6** the strict-JSON `EnhancedNotes` contract, the `emit_enhanced_notes` tool,
> origin (`user`/`ai`) rules, and `sourceSegmentIds` stay **app-owned scaffolding** —
> user and template text only fill a constrained guidance slot, and every LLM output is
> Zod-validated with a markdown fallback on failure. **§1.2** any new LLM provider key is
> stored via `safeStorage` and every model call originates in **main**; keys are never
> logged or sent to the renderer. **§1.5** enhancement never deletes the user's notes —
> the anti-AI-tell post-process touches only `ai`-origin text. **§1.7** language
> detection/override behavior is unchanged. The `Enhancer` interface stays the seam;
> providers plug in behind it.

## The blocks

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | Template Instruction Model | Make `instructions` a guidance slot, not a full prompt; move mechanics into always-on scaffolding; reseed the built-ins from `MEETING_TEMPLATES.md` | Engine + migration (foundational) |
| 02 | Template Editor UX | Bigger scrollable editor, starter example, canned snippet buttons, "Optimize with AI" prompt rewrite | UI + IPC |
| 03 | Summary Depths | One enhancement call returns key-points **and** extended notes; UI toggles between them | Contract + UI |
| 04 | AI Cost & Quality | Task→model routing (Haiku for cheap tasks), prompt caching, Economy/Quality toggle, anti-AI-tell style directive, shorter titles | LLM rules |
| 05 | Multi-Provider | A generic OpenAI-compatible provider behind the `Enhancer`/chat seam; Anthropic stays default/recommended | Feature |
| 06 | UI Polish | Remove the per-meeting cost chip from the header; enlarge the Settings dialog | UI |

## Dependencies

```
v1–v5 (shipped)
  └─ 01 Template instruction model ── prompt.ts split (scaffold always-on; instructions
        │   = guidance slot) + additive migration v11 reseeding the built-ins from
        │   MEETING_TEMPLATES.md. Foundational: fixes the scaffolding leak.
        │
        ├─► 02 Template editor UX ── depends on 01's instruction-slot model (the editor
        │     now shows/inserts guidance, not mechanics). Adds editor sizing, starter
        │     example, snippet buttons, and the "Optimize with AI" IPC.
        │
        └─► (shares prompt.ts with) 04 — the anti-AI-tell style directive lives in the
              same always-on scaffold introduced in 01.

03 Summary depths ── extends the EnhancedNotes contract + emit_enhanced_notes tool to
      return keyPoints alongside blocks; adds a depth toggle. Largely independent;
      coordinate the contract change with 04/05 (both must honor the same schema).

04 AI cost & quality ── centralizes model selection (task→model), adds caching, the
      Economy/Quality setting, the style directive, and shorter titles.
        │
        └─► 05 Multi-provider ── builds on 04's centralized model/provider seam; adds a
              generic OpenAI-compatible provider validated by the same Zod contract.

06 UI polish ── independent (header cost chip removal + larger Settings dialog).
```

## Suggested order

1. **01 Template instruction model** first — foundational. It corrects what the editor
   and the built-ins *mean*, so 02 builds on the clean model. Pure prompt-assembly change
   plus one additive reseed migration; unit-testable; low risk.
2. **02 Template editor UX** next — the authoring experience on top of 01.
3. **04 AI cost & quality** — centralizes model selection and adds the style directive
   that shares 01's scaffold. Land before 05.
4. **03 Summary depths** — can land any time after the contract change is agreed; do it
   alongside 04 so the tool-schema edits are coordinated.
5. **05 Multi-provider** — last of the AI blocks; depends on 04's provider seam.
6. **06 UI polish** — independent; land whenever.

## Cross-cutting notes (hold across every block)

- **`instructions` is a guidance slot, not a prompt (§1.6).** After block 01, the
  scaffolding (tool use, origin rules, `sourceSegmentIds`, block types) is always emitted
  by `buildSystemPrompt`; template/global text only fills the guidance slot and can never
  remove the contract. `MEETING_TEMPLATES.md` is the canonical guidance-only phrasing.
- **One enhancement call, two depths (03).** Key-points and extended notes come from the
  *same* `emit_enhanced_notes` call — no second API round-trip, so the depth toggle costs
  nothing extra.
- **Cheaper where it doesn't hurt (04).** Titles and long-transcript chunk-summarization
  move to Haiku; enhancement and chat stay on Sonnet (Quality) or shift toward Haiku
  (Economy) per the user setting. Prompt-cache the transcript so re-enhance and titling
  reuse it.
- **Provider-independent contract (05).** Any provider must satisfy the same Zod
  `EnhancedNotes` schema; non-conforming output falls back to markdown and is marked
  degraded, exactly as today. Anthropic remains the default and is labeled "optimized
  for" in Settings.
- **Migrations only (§7).** Block 01 ships an additive `version: 11` migration that
  reseeds only `is_builtin = 1` rows; user templates are never touched. Block 03 needs no
  migration (enhanced notes persist as JSON in `notes.enhanced_json`). Confirm the
  settings storage shape before any migration in 04/05.

## How to use a block with Claude Code

Feed the block file plus the codebase. Same discipline as v03/v04/v05: read the existing
code, propose the fit before writing, ship as its own branch, hold the §1 invariants, and
keep `pnpm typecheck/lint/test/build` green. For the contract-touching blocks (01, 03,
05), unit-test the prompt assembly, the Zod schema (with and without the new fields), and
the migration against a **populated** temp DB before merge.
