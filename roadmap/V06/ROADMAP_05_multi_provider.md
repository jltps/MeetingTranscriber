# ROADMAP_05 — Multi-Provider (Generic OpenAI-Compatible)

**Type:** feature · **Risk:** medium · **Depends on:** block 04 (centralized model/provider
seam). **Last of the AI blocks.**

## Decision

Support **one generic OpenAI-compatible provider** — configured by base URL + model id +
API key — rather than per-vendor SDKs. This single adapter covers OpenAI, OpenRouter,
local Ollama, and other OpenAI-compatible gateways. **Anthropic stays the default and is
labeled "optimized for / recommended"** in Settings; the app is tuned for Claude and says
so.

## Problem

Enhancement, titles, and chat are hardwired to Anthropic via the `Anthropic` SDK and the
hardcoded model constants. The `Enhancer` interface
(`scribe/src/main/enhancer/enhancer.ts`, lines ~49–52) exists but there is no factory and
no provider abstraction. Some users want to bring their own provider/key.

## Changes

### 1. Provider seam

Build on block 04's centralized model resolver. Introduce a **provider** dimension
alongside model selection:
- An `LlmProvider` notion with two implementations: `anthropic` (today's behavior) and
  `openai-compatible` (new). Keep the existing `Enhancer` interface as the public seam;
  the chat and title callers select a provider the same way.
- The `openai-compatible` adapter calls the configured base URL with the OpenAI
  chat-completions shape, requesting structured output via **tool/function calling**
  (preferred) or JSON mode, and maps the result into `EnhancedNotes`.

### 2. Same contract, provider-independent (§1.6)

Whatever the provider returns is parsed by the **same `EnhancedNotesSchema`** (including
`keyPoints` from block 03). On non-conforming output, the **existing** retry →
markdown-fallback path runs and the result is marked `degraded`, exactly as today. The
strict-JSON contract is owned by the app, not the provider. Anthropic-specific niceties
(prompt caching from block 04) are simply skipped for the generic provider.

Document the hard constraint: a provider/model that cannot do tool-use or JSON output
will frequently fall back to degraded markdown — note this near the Settings field so the
user understands why Anthropic is recommended.

### 3. Settings UI + config

In `SettingsModal.tsx` (API Keys / Enhancement area):
- A **provider selector** — *Anthropic (recommended, optimized for)* vs *OpenAI-compatible*.
- For OpenAI-compatible: **base URL**, **model id**, and **API key** fields.
- The provider key is stored via **`safeStorage`** next to the existing keys; base URL +
  model id can live in settings. **All calls originate in main** (§1.2); keys never reach
  the renderer and are never logged.
- New IPC + Zod for reading/writing provider config (key write goes through the existing
  secrets path; config read returns *whether* a key is set, never the key itself).

### 4. Pricing

Provider/model cost varies and is user-configured; the built-in `estimateCost` is
Anthropic/Deepgram-specific. For the generic provider, either accept an optional
user-entered per-1M rate or show token counts without a dollar estimate. Keep it honest —
don't display an Anthropic-priced figure for a non-Anthropic call.

## §1 invariants

- **§1.2** — provider key via `safeStorage`; all model calls from main; keys never logged
  or sent to the renderer.
- **§1.6** — every provider's output is validated by the same Zod contract with the
  markdown fallback; the contract is non-editable scaffolding.
- **§4** — provider-config channels declared once in the shared contract with Zod;
  exposed through `window.api`; no raw `ipcRenderer`, no dynamic channel names.

## Tests

- Provider-config Zod schema (base URL/model required when provider is openai-compatible;
  key presence reported without exposing the key).
- The `openai-compatible` adapter maps a representative tool/JSON response into an object
  that passes `EnhancedNotesSchema`.
- Degraded fallback: a non-conforming provider response routes to the markdown fallback
  and sets `degraded`.

## Verification

`pnpm typecheck && pnpm lint && pnpm test`. Manual: select Anthropic → unchanged behavior;
select OpenAI-compatible with a real endpoint/key → enhancement produces validated notes
(or a clearly-marked degraded fallback); confirm the key never appears in logs or the
renderer and the "optimized for Anthropic" note is visible.
