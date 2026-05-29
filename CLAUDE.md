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

### The "build" runbook (run *all* of this when the user says "build")

When the user gives a "build" / "ship vX.Y.Z" instruction, execute the full
release sequence below in order — do not stop after just packaging the
installer. This sequence was made durable here in v0.7.2 per direct user
instruction.

1. **Update the docs first.** Add the new version to `README.md` (status
   line + a new `vX.Y.Z` section + the document map) and to `CLAUDE.md`'s
   "Already shipped beyond v1" list. If the version corresponds to a roadmap
   folder (e.g. `roadmap/VXXX/`), commit any untracked roadmap files in that
   folder and mark its `ROADMAP_00_INDEX.md` as shipped.
2. **Commit the doc updates** (`docs: record VXXX … as shipped`).
3. **Bump `scribe/package.json` version to X.Y.Z** and commit
   (`chore(release): X.Y.Z`). Keep this commit version-bump-only — no other
   code changes.
4. **Push main**: `git push origin main`.
5. **Tag + push the tag**: `git tag vX.Y.Z && git push origin vX.Y.Z`.
   The tag push triggers `.github/workflows/release.yml`, which builds on a
   Windows runner, gates on typecheck/lint/test, and publishes the installer
   + `latest.yml` + `.blockmap` to the GitHub Release via electron-builder's
   `github` provider.
6. **Build the installer locally too** (`corepack pnpm dist`, run in
   background). This produces `scribe/release/Nexus Setup X.Y.Z.exe` with
   `--publish never`, giving a sanity-check installer that doesn't touch the
   Release.
7. **Wait for CI** (`gh run watch <id> --exit-status`) and verify the
   Release exists with the installer attached
   (`gh release view vX.Y.Z` — should list `Nexus-Setup-X.Y.Z.exe`,
   `latest.yml`, and `Nexus-Setup-X.Y.Z.exe.blockmap`).
8. Optional: write the release notes with `gh release edit vX.Y.Z --notes …`
   if the auto-generated content needs improvement.

The order matters: docs commit before the release commit so the published
tag points at a state where the docs already describe the shipped version.
Local `pnpm dist` runs in parallel with CI — it's a parallel sanity check,
not a precondition for shipping.

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
- **V07 — In-app auto-update from GitHub Releases (shipped; `roadmap/V07`):** the
  packaged app now updates itself. `electron-updater` wired into the main process
  (`scribe/src/main/updater/`): boot check 60 s after `whenReady` + 6 h periodic,
  auto-download in the background, state machine pushed to the renderer over four
  Zod-validated IPC channels (`update:{checkNow,install,getState,status}`, plus
  `update:{getSettings,setAutoEnabled}` to back the Settings toggle). **Recording-
  aware install guard** (`install-guard.ts` consults `isTranscriptionActive()` in
  `ipc/transcription.ts`) — `quitAndInstall` is refused while a meeting is being
  recorded (§1.5). Three small UI surfaces: an in-app banner when an update is
  ready (mounted between TitleBar and LayoutShell), a Settings → Updates section,
  and an About dialog opened from a new `Info` button in the title bar. Build
  side: `electron-builder.yml` switched to `publish: github` (`jltps/MeetingTranscriber`)
  with NSIS `oneClick: true` (silent installs are required for background
  updates — same UX as Slack/Discord per-user installers; documented in §11);
  the hand-rolled `scripts/write-latest-yaml.mjs` and tracked `release/latest.yaml`
  were removed (electron-builder now writes `latest.yml` natively under the
  github provider); `pnpm dist` uses `--publish never`. CI: `.github/workflows/
  release.yml` builds on `windows-latest` for every `v*.*.*` tag push, gates on
  typecheck/lint/test, runs a tag-vs-package version check, then publishes via
  `electron-builder --publish always` with `GH_TOKEN`. Installer icon: a small
  `rcedit` afterPack hook (`build/after-pack.cjs`) embeds the Nexus icon +
  `ProductName/FileVersion` metadata on the packaged `.exe` so File Explorer /
  Task Manager show the Nexus mark; `signAndEditExecutable: false` stays off so
  electron-builder doesn't trigger the winCodeSign download (macOS symlinks fail
  to extract on Windows without Developer Mode). Holds §1.1–§1.7; the `github`
  provider is anonymous against the public repo, so no API key is added.
- **V072 — Minor experience tweaks (shipped; `roadmap/V072`):** seven small UI/UX
  refinements that sand off rough edges from daily use. (1) **Launch splash**
  (`main/splash.ts` + `build/splash.html`) shown immediately on `app.whenReady`,
  dismissed when the main window fires `ready-to-show` — no preload, no IPC, no
  network. (2) **Unified note-window header** (`renderer/features/notes/
  NoteWindowHeader.tsx`): Folder picker + Tags dropdown + Original/Enhanced
  toggle + Export + Chat all collapse into one sticky header inside the left
  ResizablePanel; the right column is transcript-only (the old Transcript/Chat
  ToggleGroup is gone); chat takes over the notes pane via a `noteSurface`
  state. Adds **`Button variant="ai"`** for the teal→blue gradient used by
  Chat / Ask-across-notes / Optimize-with-AI. (3) **Ask-across-notes** moves
  from the TitleBar to a full-width sidebar button under Search; the TitleBar
  drops the prop. (4) **Drag-and-drop reorder + move-to-folder** via
  `@dnd-kit/{core,sortable,utilities}` (new deps): additive **migration v12**
  adds `meeting_sort_overrides (meeting_id, sort_mode, position)` with FK ON
  DELETE CASCADE; new IPC `meetingsListSortOverrides` + `meetingsSetSortPosition`
  (Zod-validated, `SidebarSortMode` enum mirrors the sidebar's `SortKey`); the
  list wraps in `DndContext`/`SortableContext`, whole-row drag with
  `activationConstraint: { distance: 4 }` so a small click still opens the
  meeting; folder rows are `useDroppable` targets (`folder:<id>` / `folder:none`);
  KeyboardSensor for a11y; on drop, all visible rows are sequence-stamped (step
  1000) and the override map reloaded. Reorder is per-sort-mode (so reordering
  in Last-updated doesn't affect A-Z). (5) **Compact/Extended card density**:
  new KV setting `notes_card_view` (no migration — existing KV table) with a
  ToggleGroup in the sidebar; `MeetingRow` branches on density (single-line
  with `py-1.5` vs the rich `py-2.5` 2-line layout). (6) **Date label on
  agenda rows**: pure-function helper `formatEventWhen(startMs, allDay, now)`
  (`renderer/features/calendar/format-when.ts`) returning "Today · 2:34 PM" /
  "Tomorrow · …" / weekday-short / "Jun 4 · …" / "Today · All day"; rounds
  day-delta over 86_400_000 ms so DST boundaries (23 h or 25 h days) still
  classify correctly; 7 unit tests pin behaviour. (7) **Tags-section
  affordance** (`renderer/features/organization/TagFilter.tsx`): the sidebar
  now always renders a "Tags" header with a `+` button that opens NameDialog →
  `org.createTag` — fresh installs had no global affordance to create a tag,
  since `TagFilter` returned `null` when empty. UI + one additive migration;
  holds §1.1–§1.7. Verification of the unified-header restructure (block 02)
  expanded scope mid-stream to relocate Folder/Tags/Export from the app header
  into the new NoteWindowHeader; `setRightTab` was retired in favour of
  `setNoteSurface` and the command-palette `toggle-tab` action became
  `toggle-chat`.
- **V073 — Transcription quality & bullet-proof Windows audio capture (shipped;
  `roadmap/V073`):** addressed two long-standing pain points hitting users on
  varied Windows hardware. (1) **Capture reliability.** Mic acquisition now
  uses a layered fallback (`{exact:id}` → `{ideal:id}` → system default) inside
  a new `acquireMicStream` helper in `renderer/audio/capture.ts`; the result
  reports which step won so `CaptureProbe` can warn when a stale stored
  deviceId got us. The main loopback grant in `main/audio/loopback.ts` now
  tries `desktopCapturer.getSources({types:['screen']})` → `['window']` → an
  audio-only response (`{audio:'loopback'}`, accepted by Electron 33), and
  pushes a typed `audio:loopbackDenied` IPC event when none works. The
  AudioContext is no longer pinned to 16 kHz — `pcm-framer.worklet.js` now
  reads `processorOptions.sourceRate` + `targetRate` and linear-decimates to
  16 kHz when they differ (fast pass-through when they match), so Bluetooth
  A2DP and 48 kHz Realtek endpoints stop silently shipping wrong-rate PCM.
  A new `runCaptureProbe()` helper spins up capture for 1.5 s and reports
  peak RMS / muted flag / fallback step — exported for a future preflight
  modal; not yet wired to the Start button. An in-meeting silence watchdog
  in `main/ipc/transcription.ts` pushes `transcription:warning` (`mic-silent`
  / `system-silent`, `cleared` on recovery) after a 3 s grace period, and a
  new `AudioWarningBanner` in the renderer surfaces both warning channels.
  (2) **Diarization quality.** New `computeBleedScore` in
  `main/transcription/me-attribution.ts` measures the rolling 10 s normalised
  zero-lag cross-correlation of mic vs system RMS envelopes (with a
  floating-point variance epsilon to keep constant envelopes from looking
  perfectly correlated). `micDominatedWindow` scales the effective dominance
  threshold (`1.5 × (1 + 2·bleed)`) and mic floor by the live score, so
  laptop-speaker setups stop mis-attributing remote speech to "Me". A new
  `audio_capture_mode` KV setting (`'auto' | 'headphones' | 'speakers'`)
  clamps the bleed score: `headphones` → 0; `speakers` → max(0.5, bleed);
  `auto` passes through. UI toggle lives in Settings → Audio. A 1-word
  median filter inside `attributeWords` flips a single mis-classified short
  (< 350 ms) word back to its neighbours' attribution, killing the
  `"Yeah."`-mid-monologue artefact. Adjacent same-direction remote fragments
  produced by `groupAttributedWords` now merge automatically when the gap is
  < 800 ms, each fragment has ≥ 3 words, and their word rates agree within
  ±25 % — covering the Deepgram-speaker-fragmentation case while leaving
  single-word backchannels untouched. Manual rename of remote speakers still
  goes through the existing V03 ROADMAP_02 `speakers.set` IPC. No DB
  migration, no IPC contract change beyond the three new channels
  (`audio:loopbackDenied`, `transcription:warning`, `settings:setAudioCaptureMode`).
  New test suite `tests/me-attribution-bleed.test.ts` (9 tests) pins bleed
  score behaviour, dominance under bleed, the capture-mode overrides, and the
  median filter; full suite stays 256 / 256 green. Holds §1.1–§1.7 — all new
  audio data is RMS scalar only, no new persistence, keys stay main-side.
  Pre-flight Start modal + onboarding audio step from the original plan
  were deferred (the watchdog + Settings panel + diagnostics already cover
  the silent-failure modes; `runCaptureProbe` is exported for the next step).
- **V074 — UI polish (shipped; `roadmap/V074`):** six surface-level refinements
  raised after a week of dogfooding. (1) **Softer AI button accent.** The
  `variant="ai"` Button (`renderer/components/ui/button.tsx`) was a bold
  teal→blue gradient + white text that competed with the solid-teal primary
  CTAs (New Note, Start). V074 recoloured it as a soft tinted gradient
  (`from-primary/10 to-info/10`) with `text-primary` label and icon; gradient
  direction preserved so the variant stays recognisable. (2) **Settings as
  vertical tabs.** `SettingsModal.tsx` regrouped its 11 sections into 10
  left-rail tabs (General / AI / Audio / Transcription / Calendar / Templates
  / Updates / Usage & Cost / Data / Privacy). Language moved from Audio to
  General; the destructive Wipe lives under Privacy. State stays hoisted at
  the top of the component so switching tabs doesn't tear down in-progress
  edits (API-key reveal flow, unsaved enhancement instructions). The
  last-opened tab persists in `localStorage` under `nexus:settings:last-tab`
  — UI-only preference, no IPC contract change. (3) **Templates full-screen
  workspace.** New `features/templates/TemplatesPage.tsx` (Back ← / Templates
  / + New header, scrollable list on left, editor on right) replaces the
  sub-Dialog-on-Settings stack. The editor body was extracted from
  `TemplateEditorModal.tsx` into a reusable `<TemplateEditor>` with
  `variant: 'modal' | 'page'` so the legacy single-template modal still
  works for per-meeting edits. New top-level `appView: 'meetings' |
  'templates'` state in `App.tsx` swaps `LayoutShell` for `TemplatesPage`
  when active; the TitleBar stays mounted for window controls. (4)
  **Customisable sidebar.** New `features/layout/use-sidebar-layout.ts`
  manages a `{order, hidden}` blob in `localStorage`
  (`nexus:sidebar:layout`); `MeetingSidebar.tsx` was refactored into per-
  section renderers (Folders, Tags, Agenda, Notes) with the top actions
  (New Note, Search, Ask-across-notes) pinned. Each non-Notes section gets a
  bounded scroll container (`max-h-[35vh] overflow-y-auto`) so long folder
  or tag lists no longer push meetings off-screen. An "Edit sidebar" panel
  at the bottom (`SlidersHorizontal` icon) replaces the section stack with
  checkboxes + ↑↓ reorder buttons + Reset; the last visible section's hide
  checkbox is force-disabled so users can never lock themselves out. Drag
  reorder was deliberately *not* used — the outer DndContext for meeting-row
  drag would conflict. The previously combined Folders+Tags panel was split
  so the two sections can be hidden/reordered independently. (5) **About
  dialog cleanup.** `AboutDialog.tsx` lost the Releases + Source outlinks
  (the V07 auto-updater makes the first redundant; the second leaked the
  repo into the consumer UI). "Check for updates" is the only button left.
  The `openExternal('releases' | 'repo')` IPC channel stays in place — out
  of scope to remove. (6) **Typed-WIPE double-confirm.** New
  `features/settings/WipeDataDialog.tsx` replaces the single
  `window.confirm()`. The dialog disables its destructive button until the
  user types the literal phrase `WIPE` (case-sensitive); `settings.wipe()`
  is unchanged on the wire. UI-only block — no DB migration, no new IPC
  channels, no §1 invariant moves. Two localStorage keys
  (`nexus:settings:last-tab`, `nexus:sidebar:layout`) chosen over new
  typed IPC because they're renderer-only preferences with no main-side
  observer.
- **V075 — Diarization & transcript fidelity (shipped; `roadmap/V075`):**
  squeezes more diarization quality + transcript fidelity out of Deepgram's
  May-2026 feature refresh and reinstates the pre-V05 2-channel capture as
  an opt-in quality tier. Four blocks. (1) **`paragraphs=true` on the
  Deepgram stream + `paragraphIndex` on every word** (`deepgram.ts`,
  `parse.ts`). Deepgram's paragraph boundaries are explicitly
  diarization-aware ("influenced by speaker changes") and give us a
  second-order boundary signal the V073 auto-merge was re-inventing from
  word-rate + 800 ms-gap heuristics. `-1` is the sentinel for "no paragraph
  data on this message" so the legacy multichannel + no-paragraphs paths
  behave bit-identically to V073. **Streaming is pinned to v1**: Deepgram's
  newer `diarize_model` parameter is **pre-recorded only** and returns
  HTTP 400 on streaming — documented in the `buildDeepgramQuery` comment
  block. New `tests/deepgram-query.test.ts` pins the entire query string
  against silent drift (would have caught the V05 `detect_language`
  regression). (2) **Paragraph-aware grouping & remote-fragment merging**
  (`me-attribution.ts`). `autoMergeAdjacentSpeakers` gains a
  same-paragraph fast-path: two adjacent remote fragments inside the same
  Deepgram paragraph merge **unconditionally** — Deepgram itself is
  asserting they're one thought, a stronger signal than the V073 heuristic.
  Long single-speaker runs spanning paragraphs emit one segment with
  `paragraphBreaks: number[]` (character offsets) so `TranscriptPanel`
  inserts an internal blank-line break for readability. **Additive
  migration v13** adds two NULLable JSON columns on `transcript_segments`
  (`paragraph_breaks_json` here; `word_spans_json` for block 03). (3)
  **Filler words capture & subdued UX** (`parse.ts`, `me-attribution.ts`,
  Settings → Transcription, `TranscriptPanel.tsx`). `filler_words=true` is
  English-only per Deepgram — gated on `language=en*` or `auto` (nova-3
  multilingual mode); preserves the seven canonical fillers (`uh, um,
  mhmm, mm-mm, uh-uh, uh-huh, nuh-uh`) Deepgram otherwise strips. Each
  word carries `isFiller: boolean`. New `inheritShortFillerAttribution`
  pre-pass in `attributeWords` makes short isolated fillers (≤ 200 ms)
  inherit their nearest non-filler neighbour's `isMe` instead of running a
  noisy per-word dominance check on a 100 ms "uh" — runs before the V073
  median filter so it sees a coherent run. `groupAttributedWords` records
  filler offsets as `wordSpans` (carried across `autoMergeAdjacentSpeakers`
  with the right offset shift); the renderer wraps each filler in
  `italic text-muted-foreground`. New KV setting
  `transcript_include_fillers` (default `true`) + Zod-validated IPC
  channel; when `false`, fillers are dropped at the parser stage so the 5
  fillers Deepgram returns even without the flag are also stripped. (4)
  **Opt-in stereo "Best quality" capture mode**
  (`pcm-framer.worklet.js`, `capture.ts`, `App.tsx`, Settings → Audio).
  Reinstates the pre-V05 2-channel capture path behind a new
  `captureQuality: 'cost-saver' | 'best-quality'` KV setting. Best quality
  runs Deepgram's "combine both" recommendation from
  `docs/multichannel-vs-diarization`: `multichannel=true` + `diarize=true`
  with mic on channel 0 (always "Me" — no heuristic, just a fact) and
  system on channel 1 (Deepgram-diarized for remote speakers). The
  worklet gains an `outputChannels: 1 | 2` processor option and emits
  interleaved `[mic0, sys0, mic1, sys1, …]` PCM in stereo mode. The rest
  of the legacy parser path (`parse.ts:64-75` ch0 → "Me",
  `splitBySpeaker` → "Speaker N") was already wired (V05 mono gated it
  behind `channels === 1` instead of deleting it) — V075 only re-validates
  it. Trade-off is ~2× billed Deepgram channels (the existing V05 cost
  accounting handles the per-meeting bump automatically). The V073
  "Listening on" row auto-disables in Best quality (stereo eliminates
  bleed at the source). 281 tests pass (was 256). §1.1 holds — stereo
  audio still never touches disk; §1.7 holds — the `filler_words` gate
  preserves PT/other-language behaviour exactly.
- **V0.7.1 — production OAuth credentials for calendar (shipped):** v0.7.0 shipped
  the V07 updater alongside calendar code (V03) that still pointed at a dev Google
  client and an empty Microsoft client, so Connect failed on fresh installs.
  v0.7.1 bundles the production Google + Microsoft client IDs in
  `scribe/src/main/calendar/config.ts` (both are public — Google "Desktop app"
  client + Microsoft Entra "Mobile & desktop" public client) and bakes the Google
  client_secret into the packaged main bundle at build time via a vite `define`
  in `scribe/electron.vite.config.ts` that reads the `GOOGLE_OAUTH_CLIENT_SECRET`
  GitHub Actions secret (`.github/workflows/release.yml`). The public repo stays
  free of the `GOCSPX-` prefix that GitHub's secret scanner would flag; local
  dev keeps using `scribe/.env`. This was also the first release published
  end-to-end by the V07 auto-update pipeline (tag push → CI workflow → GitHub
  Release → in-app updater on v0.7.0 picks it up). §1.2 holds — the secret
  reaches only the main bundle, never the renderer, and tokens stay encrypted
  via `safeStorage` in `secrets/calendar-tokens.ts`.
- Still deferred (don't build unless asked): transcript/enhancement quality eval loop
  (v03 ROADMAP_03), accounts + cloud sync + sharing (v03 ROADMAP_04 later phases),
  macOS, **code-signing the Windows installer** (procure OV/EV Authenticode cert
  → flip `signAndEditExecutable: true` + add `CSC_LINK`/`CSC_KEY_PASSWORD` CI
  secrets; removes SmartScreen warnings on first install).
