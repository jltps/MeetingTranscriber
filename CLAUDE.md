# CLAUDE.md

Standing conventions and guardrails for this repository. **The app already exists**
— v1 was built from the original spec. This file governs how to *extend and
maintain* it, not how to build it from scratch.

**Ground truth is the code, not the docs.** Where this file or any spec disagrees
with what's actually in the repository, the **existing code wins** — read it first
and reconcile the docs to it, never the reverse. The one exception is §1: those
invariants are non-negotiable even if current code violates them (if it does, flag
it as a bug to fix).

Roles: `PRODUCT_SPEC.md` is the original v1 product intent (now *implemented* —
historical reference). The post-v1 specs live under `roadmap/`:
`roadmap/v02/FEATURES_LANGUAGE_PROMPT_TEMPLATES.md` (language, prompt control,
templates — **shipped**), `roadmap/v03/ROADMAP_*.md` (the v3 building-block backlog),
and `roadmap/v04/ROADMAP_*.md` (the UI/UX + rebrand phase — **shipped**). Each folder's
`ROADMAP_00_INDEX.md` is its map. v02 and v04 are fully shipped; most of v03 is — see
those indexes and `README.md` for current status. Inline `FEATURES …` and
`ROADMAP_NN …` references in this file point into those folders. This file is *how*
the code should look and behave.

The app itself lives in the `scribe/` subdirectory (these docs sit at the repo
root). All commands in §11 run from `scribe/`. **The product is now named Nexus**
(renamed from Scribe in V04); the `scribe/` directory, the `com.scribe.app` app id,
and the `scribe.sqlite` database keep the original name on purpose, so the rename
never orphaned existing user data — do not "finish the rename" by changing them.

---

## 0. Orientation (read before writing code)

- This is **Nexus** (formerly Scribe): a bot-free, device-audio meeting notepad for
  **Windows** (Electron + React + TypeScript). It transcribes the full meeting by
  capturing system audio + mic, never joins the call, and never stores audio.
- **v1 is built.** Before changing anything, read the relevant existing code and
  match its established patterns (structure, naming, IPC style, DB access). Do not
  introduce a second way of doing something that already has a way.
- For **new features**, work from the relevant `roadmap/v03/ROADMAP_*.md` block (or
  `roadmap/v02` for language/template work). Propose how a feature fits the existing
  code *before* writing it; don't assume the structure in §3 below is exactly what
  got built — verify.

## 1. The non-negotiable rules

These are correctness/safety invariants, not style preferences. Never violate
them, even if a task seems to ask for it — flag the conflict instead. If existing
code violates one, treat that as a bug to surface, not a precedent to follow.

1. **No audio is ever written to disk.** No recording files, no full-session
   buffers, no temp `.wav`. Audio frames exist in memory only long enough to be
   sent for transcription, then are dropped. There is no audio table and no save
   path. (`PRODUCT_SPEC.md` §6.4, §7.)
2. **API keys never reach the renderer in plaintext and never get logged.**
   Store via Electron `safeStorage`. Anthropic calls and (preferably) the
   Deepgram socket originate in the **main process**.
3. **Renderer is untrusted.** `contextIsolation: true`, `nodeIntegration: false`,
   `sandbox: true` where feasible. No Node APIs in the renderer. All privileged
   work crosses a typed IPC bridge.
4. **No bot, no meeting-platform integration.** We only touch OS audio. Do not
   add Zoom/Teams/Meet SDKs or APIs.
5. **The user's notes are sacred.** Enhancement may expand them, never delete or
   silently rewrite them. AI text the user edits becomes user-owned.
6. **User-supplied prompt text never breaks the JSON contract.** Custom
   instructions and templates only fill a constrained slot. The strict-JSON schema,
   origin rules, and `sourceSegmentIds` are non-editable scaffolding. Always
   validate enhancer output with Zod and fall back to plain markdown on failure.
   (`FEATURES_LANGUAGE_PROMPT_TEMPLATES.md` §B.)
7. **Never default to English.** Transcription auto-detects or uses the chosen
   language; enhanced notes are written in the transcript's language unless
   overridden. The app must work in Portuguese.
   (`FEATURES_LANGUAGE_PROMPT_TEMPLATES.md` §A.)

If a requested change would break one of these, stop and say so.

## 2. Tech stack (match what's installed; don't substitute without being asked)

The intended stack is below. **Check `package.json` for the versions and libraries
actually in use** and match them — if the build chose something different (e.g. a
different state or styling approach), follow the code, and only raise a swap if
there's a real problem.

- Electron (loopback audio needs **≥ v31**; currently pinned to **33**), via
  `electron-vite`.
- React 18 + TypeScript (`strict: true`) + Vite.
- **Tailwind CSS v4** (CSS-first `@theme`, semantic CSS-variable design tokens) for
  styling, with **light/dark/system** theming synced to Electron `nativeTheme`.
- **shadcn/ui** (copy-in components in `renderer/components/ui/`) on **Radix** +
  **lucide-react** icons + **cmdk** (command palette) + **react-resizable-panels**.
  This is the one component vocabulary — don't hand-roll a second modal/dropdown/button.
- TipTap (ProseMirror) for the notes editor.
- `better-sqlite3` for local storage (main process only).
- Web Audio API + AudioWorklet for capture/mix.
- Deepgram streaming (WebSocket) for cloud transcription **and** local Whisper
  (`@xenova/transformers`) for offline transcription — both behind the one
  `TranscriptionSession` interface.
- Anthropic Claude API for enhancement, titles, and chat (default; the app is tuned for
  it), with a pluggable **OpenAI-compatible** provider via the `openai` SDK behind the
  `main/llm/` factory. Model selection is centralized in `main/enhancer/models.ts` (see §8).
- `react-markdown` + `remark-gfm` to render chat answers as formatted Markdown.
- Zod for runtime validation of all IPC payloads and all LLM JSON output.
- `electron-builder` (NSIS) for packaging.

Use **pnpm**. Pin versions. Prefer the platform/standard library over adding a
dependency; justify any new dependency in the commit message.

## 3. Project structure (verify against the actual tree)

The structure below was the *intended* layout. The real repo may differ — **run a
directory listing and follow the actual structure**; update this section to match
reality rather than moving files to match this section.

```
scribe/build/      # brand assets: icon.ico, icon.png, make-icons.mjs (V04 rebrand)
scribe/src/
├─ main/        # Electron main process (privileged):
│               #   window (index.ts), ipc/ (incl. organization), db/ (incl.
│               #   migrations.ts, organization.ts), audio/, transcription/
│               #   (deepgram + whisper), enhancer/ (incl. prompt.ts, title.ts,
│               #   pricing.ts), chat/ (+ retrieval/), calendar/ (google + microsoft,
│               #   oauth, pkce), secrets/, theme.ts, window-state.ts, logger.ts
├─ preload/     # contextBridge: exposes typed window.api only
├─ renderer/    # React app (untrusted): app/ (incl. TitleBar.tsx, index.css tokens),
│  │            #   features/, components/ (ui/ = shadcn, EmptyState), assets/ (logo.svg),
│  │            #   audio/, lib/
│  └─ features/ # meetings/, notes/, transcript/, settings/, templates/, calendar/,
│               # chat/, organization/ (folders+tags), commands/ (palette), layout/,
│               # onboarding/  (one folder per feature)
└─ shared/      # types.ts + ipc-contract.ts + pricing.ts (Zod). NO node/electron/react.
```

Structural rules (these hold regardless of exact folder names):
- The shared types/contract layer must import nothing from `electron`, `node:*`,
  or React — pure types + Zod, importable from any process.
- Main and renderer never import each other; they communicate **only** through the
  preload bridge using channels declared in the shared IPC contract.
- One feature = one folder under the renderer's `features` dir.
- New code goes where its neighbours already live. Don't create a parallel layout.

## 4. IPC contract discipline

- Every IPC channel is declared once in the shared IPC contract with a Zod schema
  for request and response. New features (templates CRUD, language settings) add
  their channels there, matching the existing pattern.
- `ipcMain` handlers validate input with the schema before doing anything.
- The preload bridge exposes a single typed object: `window.api`. No raw
  `ipcRenderer` in the renderer. No dynamic channel names.
- Audio PCM frames are the one high-frequency channel — payload stays a
  transferable (`ArrayBuffer`); don't Zod-validate per frame (validate the
  start/stop control messages instead).

## 5. Coding conventions

- TypeScript `strict`. No `any` (use `unknown` + narrowing). No non-null `!`
  unless provably safe with a comment.
- Functional React components + hooks. No class components.
- Naming: components `PascalCase`, hooks `useCamelCase`, component files
  `PascalCase.tsx`, everything else `kebab-case.ts` — **unless the existing repo
  already settled on a different convention, in which case match it.**
- Keep modules small and single-purpose. Audio, transcription, and enhancement
  each stay behind their interface — UI code imports the interface + a factory,
  never a concrete provider.
- Async: prefer `async/await`; always handle rejection. Sockets and the
  AudioContext must have explicit teardown on stop/unmount — leaks here mean the
  mic stays hot, which is unacceptable.
- Errors: fail loud in dev, degrade gracefully in UI. Surface transcription/LLM
  failures to the user; never silently swallow.
- No `console.log` in committed code — use the logger, which must never log audio
  bytes or API keys.
- **Targeted edits over wholesale rewrites.** When changing existing code, make the
  smallest change that fits the established style. Don't reformat or restructure
  files you're only touching for a small feature.

## 6. Audio subsystem rules (highest care — already built, change with care)

- Capture/mix lives in the renderer audio module; the loopback grant lives in the
  main process. Don't scatter audio logic elsewhere.
- On stop or component unmount: stop every `MediaStreamTrack`, close the
  `AudioContext`, close the Deepgram socket, null out buffers. Verify the mic
  indicator goes off.
- Transcription sends a **single mono channel** (mic + system downmixed in the
  worklet) to halve Deepgram's per-channel billing. Speakers are split by
  **diarization**, and "Me" is derived in the main process by correlating
  Deepgram's word timings against the per-frame mic-vs-system RMS levels
  (`main/transcription/me-attribution.ts`) — it is no longer a physical channel.
  The per-frame levels are scalars, never audio bytes (§1.1). The legacy 2-channel
  path (mic = ch0, system = ch1) still works when `channels > 1` is passed.
  (V05 ROADMAP_02 introduced the heuristic; **V062 ROADMAP_01 moved attribution
  per-word** and regroups words with `isMe` as the primary partition key and
  Deepgram speaker as the secondary one, so the user's own voice coalesces into a
  single `"Me"` run even when Deepgram fragments it across speaker IDs. The
  heuristic is tuned against live calls.)
- Per-word "Me" attribution runs **only for single-channel finals**: `deepgram.ts`
  gates them through `onWords`, and the IPC layer (`ipc/transcription.ts`, the
  owner of the energy timeline) runs `attributeWords` + `groupAttributedWords`
  there. Interim results and the legacy 2-channel path keep flowing through
  `attributeSpeaker` → `attributeMe`. The on-wire `TranscriptSegment` shape is
  unchanged; this is purely how segments are produced.
- The capture module stays swappable behind its interface (Electron loopback now;
  a native WASAPI addon could replace it later without touching the renderer). Do
  not add the native addon unless the Electron path is proven to fail.

## 7. Database rules

- `better-sqlite3` runs in the main process only; the renderer reaches it via IPC.
- **Migrations only — never recreate tables.** The database now holds real user
  meetings. All schema changes ship as additive, ordered migrations
  (`ALTER TABLE …`, new `CREATE TABLE …`) run by the existing migration runner.
  Never `DROP`/recreate a populated table; never reset the DB to apply a change.
  (Schema deltas for the new features are in
  `FEATURES_LANGUAGE_PROMPT_TEMPLATES.md` §D, written as migrations.)
- `ON DELETE CASCADE` for meeting children. Deleting a template must **not** delete
  meetings that referenced it — null the reference instead.
- The "wipe all data" Settings action must leave nothing behind.

## 8. LLM / enhancement rules

- **Model selection is centralized** (V06 block 04) in `main/enhancer/models.ts`
  `resolveModel(task, mode)`: enhance/chat → Sonnet `claude-sonnet-4-6` (or Haiku
  `claude-haiku-4-5-20251001` under the Economy setting); title/summarize/optimize → Haiku.
  Don't re-introduce hardcoded model ids in callers — route through the resolver.
- **Provider is pluggable** (V06 block 05) behind the `main/llm/` factory
  (`activeEnhancer`/`activeChat`/`completeText`): Anthropic (default, recommended) or a
  generic **OpenAI-compatible** endpoint. UI/IPC never pick a provider — the factory does.
  The strict-JSON contract is provider-independent (same `EnhancedNotesSchema` + fallback).
- The enhancement prompt lives in one versioned file (`main/enhancer/prompt.ts`) — the
  always-on scaffold + a single guidance slot (templates fill the slot only, V06 block 01);
  find the existing one and edit it there.
- Output is **strict JSON** matching the `EnhancedNotes` shape, validated with Zod.
  On invalid JSON: retry once, then fall back to a plain-markdown enhancement and
  mark it degraded in the UI.
- The prompt is fixed scaffolding + a single user-instructions slot. User text
  (global instructions or a template) fills only that slot and can never remove the
  JSON/schema/source-linking rules (§1.6).
- Enhanced-notes language follows the transcript's detected language unless a
  template or setting overrides it (§1.7).
- For long transcripts, chunk and summarize-then-merge rather than truncating.
- Never send audio to the LLM. Only transcript text + user notes.

## 9. Testing

- Real loopback capture is validated manually (per-channel VU meters / live
  transcript) — automated tests can't prove it.
- Unit-test the pure pieces: any resampling/framing math, IPC Zod schemas, the
  enhancer JSON parser/validator, DB queries and **migrations** (against an
  in-memory or temp SQLite), and the new template/language resolution logic.
- Keep the renderer smoke test (create note → type → persists after reload) green.
- Don't chase coverage; cover the things that break silently — the enhancer parser,
  the IPC contract, and migrations against a populated DB.

## 10. Git & workflow

- Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`).
- **Commit directly to `main` — do not create feature branches or PRs.** (This overrides
  the earlier "one feature per branch" rule.) Keep each commit coherent and the working
  tree green (`typecheck`/`lint`/`test`) before committing.
- Each commit message states: what it changes, how it was verified, any new dependency +
  why, any schema migration added, and confirmation the §1 invariants still hold.
- Never commit secrets, `.env` with real keys, or any audio fixture. Ensure
  `.gitignore` covers `node_modules`, `dist`, `out`, `*.sqlite`, `.env*`.

## 11. Commands (use what's in package.json)

```
pnpm install
pnpm dev          # run Electron + Vite
pnpm typecheck    # must pass before any PR
pnpm lint         # must pass before any PR (incl. jsx-a11y on the renderer)
pnpm test
pnpm build        # compile main/preload/renderer (electron-vite build) — no installer
pnpm dist         # electron-builder NSIS installer (Windows). Uses --publish never; CI publishes.
```

If the actual script names differ, use those and update this list. `typecheck` and
`lint` must be clean before any task is considered done.

**Releases (V07).** GitHub Releases is the source of truth for the in-app
auto-updater. To ship: bump `scribe/package.json` `version`, commit
(`chore(release): X.Y.Z`), then `git tag vX.Y.Z && git push --tags`. The
`.github/workflows/release.yml` workflow runs on a Windows runner, gates on
typecheck/lint/test, and publishes the installer + `latest.yml` + `.blockmap`
to the GitHub Release for the tag via electron-builder's `github` provider.
After the workflow finishes, edit the Release's notes on GitHub
(`gh release edit vX.Y.Z --notes …`). The local `pnpm dist` runs with
`--publish never`, so it produces an installer for manual testing without
touching the Release.

**Silent NSIS install (V07).** `electron-builder.yml` is configured with
`nsis.oneClick: true` so background auto-updates can install without
prompting. The tradeoff is that *first-time* installs are also silent — no
install-directory picker — which is the same UX as Slack/Discord/VS Code
per-user installers. `deleteAppDataOnUninstall: false` keeps the user's DB
across updates and uninstalls.

## 12. When you're unsure

- Read the existing code first. If a task is ambiguous or seems to fight the
  current structure, ask before generating large amounts of code.
- If something seems to require violating a §1 invariant, stop and surface it.
- For new work, cross-check `FEATURES_LANGUAGE_PROMPT_TEMPLATES.md`; for original
  v1 intent, cross-check `PRODUCT_SPEC.md` — but remember the shipped code is ground
  truth where they conflict.
- Already shipped beyond v1 (don't rebuild — extend the existing code): language +
  auto-detect, prompt control + templates, reliability/usage-cost, speaker naming,
  export + backup, **offline Whisper**, **calendar auto-start** (Google + Microsoft),
  **post-meeting chat**, and **cross-meeting querying**.
- **V04 — UI/UX + rebrand (all shipped; `roadmap/v04`):** Tailwind-v4 design tokens +
  light/dark/system theming; shadcn/ui + lucide component system; frameless window
  with a custom title bar (native menu removed); **folders + tags** (DB migration v9,
  also cross-meeting-chat scopes); **command palette** + keyboard shortcuts over an
  action registry; window-state persistence + responsive narrow-width layout;
  onboarding flow + empty states; an accessibility pass (AA contrast both themes,
  focus/keyboard, reduced-motion, ARIA); and the **Scribe → Nexus rebrand** (icon,
  logo, installer identity). UI-only — no §1 behavior changed.
- **V05 — Transcription quality & cost (shipped; `roadmap/v05`):** real speaker
  **diarization** (`diarize=true` + `smart_format`) so multiple remote speakers no
  longer merge into one; **single mono channel** capture that ~halves Deepgram's
  per-channel bill, with "Me" recovered from a mic-energy heuristic
  (`main/transcription/me-attribution.ts`); per-meeting billed-channel cost
  accounting (DB migration v10). Decision on record: **stay on nova-3, not Flux**
  (a voice-agent model lacking diarization/word-timing/meeting support, at higher
  cost). The mono "Me" heuristic is tuned by live multi-person validation (§6, §9).
- **V062 — Per-word "Me" attribution (shipped; `roadmap/V062`):** V05's
  segment-level mic-energy classification scattered the user's own voice across
  multiple Deepgram speaker IDs (Deepgram does not preserve a stable identity
  across pauses/language shifts, and per-segment averaging buried the dominance
  signal on long mixed segments). V062 decides `isMe` **per word**
  (`attributeWords` in `main/transcription/me-attribution.ts`, tighter `windowPadMs`
  default of 60 ms) and **regroups with attribution as the primary partition
  key** (`groupAttributedWords`), so consecutive Me-words coalesce into one
  `"Me"` segment across Deepgram speaker boundaries while remote speakers still
  split on Deepgram-speaker change. Plumbed through an optional `onWords`
  callback on `TranscriptionSession` (Deepgram-only — Whisper has no word-level
  diarization); single-channel finals route through `onWords`, interim + legacy
  2-channel paths are untouched. No DB migration, no IPC contract change, no
  payload-shape change — only how segments are produced. §1.1 holds (timeline
  still scalar RMS).
- **V06 — Templates & AI capabilities (shipped; `roadmap/V06`):** template `instructions`
  are now a **guidance slot** (not a full prompt) — the LLM mechanics (tool use, origin
  rules, `sourceSegmentIds`, block types, the anti-AI-tell style directive) live in
  always-on app scaffolding in `main/enhancer/prompt.ts`, and the built-ins were reseeded
  guidance-only from `roadmap/V06/MEETING_TEMPLATES.md` (additive migration **v11**, UPDATE
  in place to preserve `meetings.template_id`). A larger/scrollable **template editor** with
  a starter example, snippet buttons, and an **"Optimize with AI"** rewrite
  (`main/enhancer/optimize-template.ts`). **Summary depths**: one `emit_enhanced_notes` call
  returns `keyPoints` + extended `blocks`, toggled in the notes pane (`EnhancedPane`).
  **AI cost & quality**: a central task→model resolver (`main/enhancer/models.ts`) routes
  title/summarize/optimize to Haiku and enhance/chat to Sonnet (or Haiku under an
  Economy/Quality setting), plus an anti-AI-tell post-process (`main/enhancer/post-process.ts`)
  and shorter (3–5 word) titles. **Multi-provider**: a generic **OpenAI-compatible**
  provider (`openai` SDK) behind a `main/llm/` factory + `ChatEngine` seam — Anthropic stays
  default/recommended; every provider's output is validated by the same `EnhancedNotesSchema`
  with the markdown fallback. **Chat** is Markdown-rendered (`react-markdown`) and
  **scoped to the meeting/notes only** (declines off-topic), with a hide-transcript toggle.
  UI polish: header cost chip removed (cost lives in Settings → Usage & Cost), larger
  Settings/editor dialogs, API "Connected" indicators. Holds §1.2/§1.5/§1.6/§1.7.
  See `roadmap/V06/ROADMAP_00_INDEX.md`.
- Still deferred (don't build unless asked): transcript/enhancement quality eval loop
  (v03 ROADMAP_03), accounts + cloud sync + sharing (v03 ROADMAP_04 later phases), macOS.
