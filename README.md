# Nexus

A **bot-free, device-audio meeting notepad for Windows**. Nexus transcribes your
whole meeting by capturing your computer's audio + microphone locally — it **never
joins the call** as a participant and **never stores audio**. You jot rough notes
during the call; afterwards an LLM fleshes them out from the full transcript,
keeping a clear visual line between what *you* wrote and what the AI added.

> Modeled on Granola. The defining promise: **capture the full meeting transcript
> with no meeting agent/bot**, working with any conferencing tool (Zoom, Teams,
> Meet, Slack huddles, plain VoIP) because it only listens to OS audio.

The app lives in [`scribe/`](scribe/). This file is the project overview; see the
[document map](#document-map) below for the spec, conventions, and build guide.

## Updating

Nexus checks for updates every few hours and downloads them in the background.
When a new version is ready, an in-app banner offers to restart and install.
You can also check manually from **Settings → Updates**, and see the version +
the GitHub Releases link from the title-bar **About Nexus** button. Updates
install silently — no installer wizard.

---

## Status

Shipping at **v0.7.2**. v1 (milestones M0–M6) is complete, the post-v1 backlog is
largely built, the product was renamed **Scribe → Nexus** (V04), **V05 — transcription
quality & cost — has shipped**, **V06 — templates & AI capabilities — has shipped**,
**V062 — per-word "Me" attribution — has shipped**, **V07 — in-app auto-update
from GitHub Releases — has shipped** (with v0.7.1 wiring the production Google +
Microsoft calendar OAuth credentials so Connect works out of the box), and
**V072 — minor experience tweaks — has shipped** (launch splash, unified note-window
header, drag-and-drop reorder, compact card density, date on agenda rows, tags
sidebar affordance, ask-across-notes in sidebar):

**v1 — core (shipped)**
- Mic + Windows loopback system audio captured as a 2-channel 16 kHz PCM stream
  (mic = channel 0 → "Me", system = channel 1 → diarized remote speakers).
- Live transcription via **Deepgram** streaming (nova-3, multichannel + diarize),
  WebSocket opened from the main process so the key never reaches the renderer.
- TipTap notes editor with autosave; meeting list, lifecycle, transcript
  persistence, and FTS search.
- Post-meeting **enhancement** with Claude: strict-JSON output validated with Zod,
  `myNote` vs `aiNote` rendering, AI text the user edits flips to user-owned.
- Source linking (jump from an AI point to the transcript segment it came from).
- Settings with `safeStorage`-encrypted keys + first-run privacy notice.
- `electron-builder` NSIS packaging.

**v2 — language, prompts, templates (shipped)**
- Multi-language transcription + auto-detect (never defaults to English).
- Global custom enhancement instructions.
- Named **enhancement templates** (built-in + custom) as first-class, fully
  editable prompts, selectable per meeting.

**v3 — backlog (mostly shipped)**
- **Reliability**: Deepgram reconnect/resilience, virtualized transcript rendering,
  per-meeting usage & cost readout.
- **Speaker naming**: rename, merge-by-name, reassign segments.
- **Data**: export a meeting; backup / restore the whole DB.
- **Local Whisper**: offline transcription via `@xenova/transformers`, behind the
  same transcription interface (downloadable models: tiny / base / small / medium).
- **Calendar**: Google + Microsoft (free/busy only, never event details),
  loopback OAuth + PKCE, agenda panel, auto-start at scheduled meeting time.
- **Cross-meeting intelligence**: per-meeting chat and cross-meeting querying with
  grounded citations.

**v4 — UI/UX + rebrand (shipped)**
- **Design system**: Tailwind v4 CSS-variable tokens, **light/dark/system** theming
  synced to the OS; shadcn/ui + lucide components throughout.
- **App shell**: frameless window with a branded **custom title bar** (native menu
  removed); window size/position/split persisted across launches; responsive
  narrow-width layout.
- **Organization**: **folders + tags** for notes, which also scope cross-meeting chat.
- **Command palette** (Ctrl/Cmd-K) + keyboard shortcuts over an action registry.
- **Onboarding** flow (welcome → privacy → connect keys → ready) + polished empty
  states with a connect-keys CTA.
- **Accessibility**: AA contrast in both themes, keyboard operability + visible focus,
  reduced-motion, ARIA/live regions (`eslint-plugin-jsx-a11y` in CI).
- **Rebrand to Nexus**: app icon, in-app logo, and installer identity. The rename is
  cosmetic — the `com.scribe.app` id and `scribe.sqlite` DB are unchanged so existing
  installs keep their meetings, keys, and layout.

**v5 — transcription quality & cost (shipped)**
- **Speaker diarization** (`diarize=true` + smart formatting): multiple remote
  speakers are now separated instead of merging into one.
- **Single mono channel** capture: Deepgram bills per channel, so downmixing mic +
  system into one stream ~halves the per-minute cost. Speakers come from diarization;
  **"Me" is recovered** from the per-frame mic-vs-system energy levels (a heuristic,
  tuned against live calls). Per-meeting billed-channel cost accounting keeps the
  usage readout correct across the change.
- Decision on record: **stay on nova-3, not Deepgram Flux** (a voice-agent model that
  lacks diarization, word timing, and meeting transcription, at higher cost).

**v6.2 — per-word "Me" attribution (shipped)**
- **Per-word attribution.** V05's segment-level mic-energy classification scattered
  the user's own voice across multiple Deepgram speaker IDs (Deepgram doesn't keep a
  stable identity across pauses/language shifts, and per-segment averaging buried the
  dominance signal on long mixed segments). V062 decides `isMe` **per word** against
  the same energy timeline (with a tighter window pad) and then **regroups with
  attribution as the primary partition key** — so consecutive Me-words coalesce into
  one "Me" segment even when Deepgram fragmented them across "Speaker 3 / 4 / 5".
  Remote speakers still split by Deepgram speaker as before.
- Single-channel finals route through a new optional `onWords` callback on
  `TranscriptionSession`; interim results and the legacy 2-channel path are
  unchanged. No DB migration, no IPC payload change.

**v6 — templates & AI capabilities (shipped)**
- **Template instruction model**: `instructions` is now a guidance slot (not a full
  prompt); the LLM mechanics live in always-on app scaffolding; built-ins reseeded
  guidance-only from `roadmap/V06/MEETING_TEMPLATES.md` (migration v11).
- **Template editor**: larger scrollable editor, a starter example, canned snippet
  buttons, and an "Optimize with AI" prompt rewrite.
- **Summary depths**: one enhancement call returns key-points **and** extended notes,
  toggled inside the notes pane.
- **AI cost & quality**: centralized task→model routing (Haiku for titles/summarization,
  Sonnet for enhance/chat), an Economy/Quality toggle, an anti-AI-tell style pass, and
  shorter 3–5 word titles.
- **Multi-provider**: a generic OpenAI-compatible provider (OpenAI/OpenRouter/Ollama…)
  behind the `Enhancer`/chat seam, with Anthropic kept as the default/recommended provider.
- **Chat**: Markdown-formatted answers, scoped to the meeting/notes (declines off-topic),
  with a hide-transcript toggle.
- **UI polish**: per-meeting cost chip removed from the header (cost lives in Settings →
  Usage & Cost), larger Settings/editor dialogs, and API "Connected" indicators.

**v7 — in-app auto-update (shipped)**
- **Updater engine** in the main process via `electron-updater`: checks GitHub
  Releases on boot (after 60 s) and every 6 h, auto-downloads in the background,
  and emits a state machine to the renderer over typed IPC.
- **Recording-aware install guard**: `quitAndInstall` is refused while a
  transcription session is active, so an update never tears down a live meeting.
- **In-app surfaces**: a non-intrusive banner when an update is ready to install,
  a Settings → Updates panel (status, progress, On/Off toggle, "Check now",
  release notes), and an About dialog (version + links to Releases / repo).
- **GitHub Releases as the source of truth**: publish provider switched from a
  generic feed to `github`; NSIS flipped to `oneClick: true` for silent installs
  and updates; the hand-rolled `latest.yaml` writer was removed in favour of
  electron-builder's native `latest.yml`.
- **Release CI**: a `.github/workflows/release.yml` workflow builds on a Windows
  runner on every `v*.*.*` tag push, gates on typecheck/lint/test, and publishes
  the installer + `latest.yml` + blockmap to the matching GitHub Release.
- **Installer icon polish**: an `rcedit` afterPack hook embeds the Nexus icon
  and `ProductName`/`FileDescription`/`FileVersion` metadata on the packaged
  `Nexus.exe`, so File Explorer and Task Manager show the Nexus mark instead of
  Electron's default icon.
- **v0.7.1**: Google + Microsoft calendar OAuth client IDs bundled and the
  Google client_secret baked into the packaged main bundle at build time via a
  vite `define` reading a GitHub Actions secret. Connect → Google / Connect →
  Microsoft now work on a fresh install with no local config. Also the first
  release published end-to-end by the V07 auto-update pipeline (CI workflow
  built, signed, and uploaded the installer + `latest.yml` on tag push).

**v0.7.2 — minor experience tweaks (shipped)**
- **Launch splash**: a small branded window appears the moment Nexus launches
  and dismisses when the main window is ready — no more black-then-empty gap
  on cold start. Theme-aware (light/dark) and honours `prefers-reduced-motion`.
- **Unified note-window header**: the per-meeting Folder picker, Tags
  dropdown, Original/Enhanced toggle, Export button, and Chat trigger all
  collapse into one sticky header above the notes pane. The right column is
  transcript-only. Chat takes over the notes pane instead of hiding behind a
  tab in the wrong column. Adds a reusable `variant="ai"` Button (teal→blue
  gradient) consumed by Chat, Ask-across-notes, and Optimize-with-AI.
- **Ask-across-notes in the sidebar**: the cross-meeting chat trigger moved
  from a tiny TitleBar icon to a full-width gradient button under Search —
  same place as the rest of the notes-navigation controls.
- **Drag-and-drop note organization**: drag a meeting card to reorder it
  within the current sort mode (overrides are per-sort-mode — reordering in
  Last-updated doesn't affect A-Z); drop onto a folder row to move it. New
  `@dnd-kit/{core,sortable,utilities}` deps, additive **migration v12** for a
  `meeting_sort_overrides` table, two new Zod-validated IPC channels, and a
  KeyboardSensor for a11y. The right-click "Move to folder" menu still works.
- **Compact / Extended card density**: a toggle in the sidebar header swaps
  meeting cards between the current rich 2-line layout (Extended, default)
  and a single-line layout (Compact) so power users with hundreds of
  meetings can scan more rows at once. Persisted via a `notes_card_view` KV
  setting (no migration).
- **Date on agenda rows**: every Upcoming row now reads "Today · 2:34 PM" /
  "Tomorrow · 9:00 AM" / "Wed · 9:00 AM" / "Jun 4 · 9:00 AM" — pure helper
  with DST-aware day-delta and 7 unit tests.
- **Tags sidebar affordance**: the sidebar always renders a "Tags" section
  with a `+` button (mirroring the Folders affordance), so fresh installs
  can create tags from the sidebar instead of having to open a meeting first.

Not yet built: transcript/enhancement quality eval loop (v03 ROADMAP_03) and the
sync/sharing phases of the data block (v03 ROADMAP_04). Code-signing the
installer (removes Windows SmartScreen warnings) is named future work — flip
`signAndEditExecutable: true` once an OV/EV cert is in hand.

## Tech stack

- **Electron 33** + **React 18** + **TypeScript** (strict) + **Vite**
  (`electron-vite`).
- **Tailwind CSS v4** (CSS-variable design tokens, light/dark/system theming) +
  **shadcn/ui** on **Radix** + **lucide** icons + **cmdk** (command palette) for the UI;
  **TipTap** (ProseMirror) for the notes editor.
- **better-sqlite3** for local storage (main process only).
- Web Audio API + **AudioWorklet** for capture/mix/resample to 16 kHz.
- **Deepgram** streaming (cloud) or local **Whisper** for transcription, both
  behind one `TranscriptionSession` interface.
- **Anthropic Claude** (Sonnet/Haiku, routed per task in `main/enhancer/models.ts`) for
  enhancement, titles, and chat — default and recommended — with a pluggable
  **OpenAI-compatible** provider (`openai` SDK) behind the `main/llm/` factory. Always
  called from the main process.
- **react-markdown** + **remark-gfm** to render chat answers as formatted Markdown.
- **Zod** for runtime validation of every IPC payload and all LLM JSON output.

## Privacy invariants (non-negotiable)

1. **No audio is ever written to disk** — frames live in memory only long enough
   to be transcribed, then are dropped. There is no audio table and no save path.
2. **API keys never reach the renderer in plaintext and are never logged.** Stored
   via Electron `safeStorage` (Windows DPAPI); network calls originate in main.
3. **Renderer is untrusted** — `contextIsolation: true`, `nodeIntegration: false`,
   typed IPC bridge only.
4. **No bot, no meeting-platform integration** — Nexus only touches OS audio.
   Calendar access is read-only free/busy, used solely to know *when* to start.
5. **Your notes are sacred** — enhancement expands them, never deletes or silently
   rewrites them.

See `CLAUDE.md` §1 for the full list; these hold even when a task seems to ask
otherwise.

## Running it

> **Build natively on Windows — not in WSL.** Loopback system-audio capture and the
> GUI window need a real Windows display and audio stack.

Prerequisites: Windows 10 (1809+) / 11, Node.js LTS, and pnpm
(`corepack enable && corepack prepare pnpm@latest --activate`).

```powershell
cd scribe
pnpm install
pnpm dev          # run Electron + Vite

pnpm typecheck    # tsc for node + web projects — must pass before any PR
pnpm lint         # eslint — must pass before any PR
pnpm test         # vitest unit tests
pnpm test:e2e     # playwright
pnpm dist         # electron-builder NSIS installer (Windows)
```

API keys (Deepgram, Anthropic) are entered in the app's **Settings** screen and
stored encrypted — never in source or committed `.env`. Calendar integration needs
a one-time OAuth client setup; see [`scribe/docs/CALENDAR_SETUP.md`](scribe/docs/CALENDAR_SETUP.md).

## Project layout

```
.
├─ README.md            # this file
├─ PRODUCT_SPEC.md      # original v1 product intent (now shipped — historical)
├─ CLAUDE.md            # standing conventions & invariants (how the code behaves)
├─ BUILD_GUIDE.md       # how to build/extend Nexus with Claude Code
├─ reference/           # M1 audio capture reference (study, not source)
├─ roadmap/
│  ├─ v02/FEATURES_LANGUAGE_PROMPT_TEMPLATES.md   # language/prompts/templates
│  ├─ v03/ROADMAP_*.md                            # post-v1 backlog blocks
│  ├─ v04/ROADMAP_*.md                            # UI/UX + rebrand phase (Nexus)
│  ├─ v05/ROADMAP_*.md                            # transcription quality & cost
│  ├─ V06/ROADMAP_*.md                            # templates & AI capabilities
│  └─ V062/ROADMAP_*.md                           # per-word "Me" attribution
└─ scribe/              # the application
   ├─ build/            # brand assets: icon.ico, icon.png, make-icons.mjs
   └─ src/
      ├─ main/          # Electron main: window, ipc/, db/, audio/, transcription/,
      │                 # enhancer/, chat/, calendar/, secrets/, theme, window-state
      ├─ preload/       # contextBridge: typed window.api only
      ├─ renderer/      # React app: app/, features/, components/ (ui/ = shadcn),
      │                 # assets/, audio/, lib/
      └─ shared/        # types + ipc-contract.ts (Zod) — no node/electron/react
```

## Document map

| File | Purpose |
|---|---|
| `PRODUCT_SPEC.md` | What v1 was — product vision, flows, audio/transcription design. Historical reference now that v1 ships. |
| `CLAUDE.md` | **How** the code should look and behave: the §1 invariants, stack, structure, IPC/DB/LLM rules. Auto-loaded by Claude Code. |
| `BUILD_GUIDE.md` | The build *process* — milestone discipline for v1 and the roadmap-driven flow for extensions. |
| `roadmap/v02/…` | Language, enhancement-prompt control, and templates (shipped). |
| `roadmap/v03/…` | Reliability, speaker naming, quality, data, Whisper, calendar, cross-meeting (see `ROADMAP_00_INDEX.md`). |
| `roadmap/v04/…` | UI/UX + rebrand: design tokens/theming, shadcn/ui, app shell, folders/tags, command palette, layout, onboarding, accessibility, Nexus rebrand. |
| `roadmap/v05/…` | Transcription quality & cost: speaker diarization, single-channel mono capture + mic-energy "Me", per-meeting cost accounting. |
| `roadmap/V06/…` | Templates & AI (shipped): guidance-slot template model + reseed, template editor UX, summary depths, AI cost/quality routing, multi-provider, UI polish (see `ROADMAP_00_INDEX.md`). |
| `roadmap/V062/…` | Per-word "Me" attribution (shipped): word-level energy classification + attribution-first regrouping so own-voice no longer fragments across Deepgram speaker IDs. |
| `roadmap/V07/…` | In-app auto-update + release CI (shipped): `electron-updater`, install guard, GitHub Releases provider, NSIS one-click, tag-driven CI build/publish. |
| `roadmap/V072/…` | Minor experience tweaks (shipped): launch splash, unified note-window header, sidebar ask-across-notes, drag-and-drop reorder + move-to-folder (migration v12), compact/extended card density, date on agenda rows, sidebar Tags affordance. |
| `scribe/docs/CALENDAR_SETUP.md` | One-time Google / Microsoft OAuth client setup. |

**Ground truth is the code, not the docs.** Where any doc disagrees with the
repository, the existing code wins — except the `CLAUDE.md` §1 invariants, which
are non-negotiable.
