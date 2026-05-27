# ROADMAP_04 — AI Cost & Quality

**Type:** LLM rules · **Risk:** medium · **Shares** `prompt.ts` scaffold with block 01;
**precedes** block 05 (provider seam).

## Problem

All three AI callers hardcode the same model and miss easy savings:
- `scribe/src/main/enhancer/anthropic.ts` (`MODEL = 'claude-sonnet-4-6'`, line ~15),
  `scribe/src/main/enhancer/title.ts` (line ~11), `scribe/src/main/chat/anthropic-chat.ts`
  (line ~8) — all `claude-sonnet-4-6`.
- Titles and long-transcript chunk-summarization use the same expensive model as full
  enhancement, even though they are simple tasks.
- The enhance path does **not** use prompt caching, while chat already caches its system
  prompt + transcript with `cache_control: ephemeral` (`anthropic-chat.ts` ~line 68).
- AI titles run "max 7 words"; AI prose carries tells (em-dashes etc.).

Goal: **lower cost and raise quality at the same time** — route cheap tasks to a cheaper
model, cache the transcript, give the user an Economy/Quality lever, and tighten output
style.

## Changes

### 1. Centralize model selection (task → model)

Add a single main-process resolver (e.g. `scribe/src/main/enhancer/models.ts`) that maps
a **task** (`'enhance' | 'title' | 'summarize' | 'chat' | 'optimize'`) and the current
**quality mode** to a model id. Replace the three hardcoded constants with calls to it.

Default mapping:

| Task | Quality mode | Economy mode |
|------|-------------|--------------|
| `enhance` | Sonnet 4.6 | Haiku 4.5 |
| `chat` | Sonnet 4.6 | Haiku 4.5 |
| `title` | Haiku 4.5 | Haiku 4.5 |
| `summarize` (long-transcript chunking) | Haiku 4.5 | Haiku 4.5 |
| `optimize` (block 02 prompt rewrite) | Haiku 4.5 | Haiku 4.5 |

Model ids per CLAUDE.md / repo conventions: Sonnet `claude-sonnet-4-6`, Haiku
`claude-haiku-4-5-20251001`. Keep the ids defined once in the resolver.

### 2. Economy / Quality toggle

A Settings option (Enhancement section of `SettingsModal.tsx`) persisting a
`qualityMode: 'economy' | 'quality'` setting that drives the resolver. Default
**Quality**. Confirm how settings are stored: if key-value (no schema columns), this is
additive with **no migration**; if columnar, add an additive migration (§7). Surface it
with a short explainer ("Economy uses a faster, cheaper model for enhancement; Quality
uses the stronger model").

### 3. Prompt caching on the enhance path

Apply `cache_control: { type: 'ephemeral' }` to the enhancement **system prompt +
transcript** the way `anthropic-chat.ts` already does. The transcript is the large,
reused block — caching it makes re-enhance and the subsequent title call cheap. Document
the expected savings in the PR. (Caching is Anthropic-specific; the generic provider in
block 05 simply skips it.)

### 4. Anti-AI-tell style directive

Add a **style directive** to the always-on scaffold introduced in block 01
(`prompt.ts`), applied to `ai`-origin output:
- Plain, direct prose. **No em-dashes or en-dashes** (`—` / `–`); use commas, periods, or
  parentheses instead.
- Avoid clichéd AI connectors ("moreover", "delve", "leverage" as a verb, "in today's
  fast-paced…") and meta phrasing ("as an AI", "I cannot").
- Optional **light deterministic post-process**: after Zod validation, strip/replace
  `—`/`–` in **`ai`-origin block `text` and in `keyPoints` only** — never in `user`
  blocks (§1.5). Keep it conservative (don't mangle ranges/URLs); the prompt directive is
  the primary mechanism, the post-process is a safety net.

### 5. Shorter titles

`scribe/src/main/enhancer/title.ts`: change the prompt from "max 7 words" to **"3–5
words, concise"**, run it on the `title` model (Haiku), and strip trailing
punctuation/dashes from the result.

### 6. Pricing accuracy

Update `scribe/src/shared/pricing.ts` (`PRICING` + `estimateCost`) to include Haiku
per-1M input/output rates so the Settings → Usage & Cost readout stays correct when cheap
tasks run on Haiku. If usage is tracked per call, attribute tokens to the model actually
used; if it's a single aggregate, document the approximation.

## §1 invariants

- **§1.2** — all calls still originate in main; keys never logged or sent to the renderer.
- **§1.5** — the anti-tell post-process touches only `ai`/`keyPoints` text, never the
  user's notes.
- **§1.6 / §8** — the model resolver only changes *which* model is called; the strict-JSON
  contract, tool use, and Zod validation are unchanged. The style directive lands in the
  guidance/scaffold area, never weakening `CONTRACT_SECTION`.
- **§1.7** — language behavior unchanged.

## Tests

- Resolver: every (task × mode) pair maps to the expected model id.
- Pricing: `estimateCost` returns correct figures for Haiku and Sonnet inputs.
- Anti-tell post-process: rewrites `—`/`–` in `ai` blocks and `keyPoints`; leaves `user`
  blocks byte-for-byte unchanged; does not corrupt URLs/number ranges.
- Title: prompt asserts the 3–5 word / no-trailing-punctuation contract (unit-test the
  trimming helper).

## Verification

`pnpm typecheck && pnpm lint && pnpm test`. Manual: toggle Economy/Quality and confirm
enhancement uses the expected model (observe via logger, never logging keys/audio);
enhance a meeting and confirm the notes contain no em-dashes; let a title auto-generate
and confirm it is 3–5 words; confirm the Usage & Cost readout reflects the cheaper title
call.
