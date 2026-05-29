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

Shipping at **v0.7.6**. v1 (milestones M0–M6) is complete, the post-v1 backlog is
largely built, the product was renamed **Scribe → Nexus** (V04), **V05 — transcription
quality & cost — has shipped**, **V06 — templates & AI capabilities — has shipped**,
**V062 — per-word "Me" attribution — has shipped**, **V07 — in-app auto-update
from GitHub Releases — has shipped** (with v0.7.1 wiring the production Google +
Microsoft calendar OAuth credentials so Connect works out of the box),
**V072 — minor experience tweaks — has shipped** (launch splash, unified note-window
header, drag-and-drop reorder, compact card density, date on agenda rows, tags
sidebar affordance, ask-across-notes in sidebar), **V073 — transcription
quality & bullet-proof Windows audio capture — has shipped** (bleed-aware "Me"
attribution, mic + loopback fallback chains, sample-rate negotiation, in-meeting
silence watchdog, adjacent-fragment auto-merge, capture-mode toggle), **V074 —
UI polish — has shipped** (softer AI button accent, vertical-tab Settings,
full-screen Templates workspace, customisable sidebar with hide/reorder and
per-section scroll, About cleanup, typed-WIPE confirm for the destructive
wipe-data action), **V075 — diarization & transcript fidelity (Deepgram
May-2026 features) — has shipped** (`paragraphs=true` on the stream + paragraph-aware
auto-merge that collapses fragmented remote-speaker runs, `filler_words=true`
with subdued rendering and short-filler attribution inheritance, and an opt-in
**Best quality** stereo capture mode that reinstates 2-channel mic/system
diarization for bullet-proof "Me" at ~2× Deepgram cost), and **V076 — bleed-aware
mic-priority "Me" attribution — has shipped** (the V073 1.5× zero-bleed baseline
that flipped quiet-Me-over-normal-remote words into "Speaker N" is now a 1.0×
lenient baseline interpolating up to 4.0× under full bleed; plus 1.5 s Me-run
hysteresis so a brief mic-energy dip between syllables doesn't fracture a
coherent Me utterance):

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

**v0.7.6 — bleed-aware mic-priority "Me" attribution (shipped)**
- **The fix.** In single-mono (cost-saver, default) capture mode, V073's
  `mic >= sys * 1.5` baseline routinely flipped a user's normal-volume
  speech to "Speaker N" when the remote was also at normal volume
  (mic/sys ratios 1.0–1.4 are common and sat just below the bar). The
  1-word median filter only rescued isolated <350 ms slips; 2-word
  clusters made it through `groupAttributedWords` /
  `autoMergeAdjacentSpeakers`, which treat per-word `isMe` as ground
  truth and can't recover the misattribution downstream.
- **Bleed-interpolated dominance** (block 01). `micDominatedWindow` now
  computes `effDominance = DOMINANCE_AT_ZERO_BLEED + (dominance −
  DOMINANCE_AT_ZERO_BLEED) × bleed` with `DOMINANCE_AT_ZERO_BLEED = 1.0`
  and a `dominance`-overridable full-bleed cap (default `4.0`). Numeric
  trace: bleed=0 → 1.0× (mic just needs to match sys); bleed=0.5 → 2.5×;
  bleed=1.0 → 4.0×. V073's formula was `dominance × (1 + 2 × bleed)`
  which started at 1.5× and overshot to 4.5× — over-strict at the
  zero-bleed common case and over-strict at the worst case. The new
  formula trusts the user's intuition that audible mic input ≈ Me
  while keeping the bleed safety net intact (the existing
  `captureMode='speakers'` clamp still floors bleed at 0.5 → bar stays
  ≥ 2.5×).
- **Me-run hysteresis** (block 02). Once a word is classified Me, the
  next `HYSTERESIS_WINDOW_MS = 1500` ms of borderline words get
  re-evaluated with a `HYSTERESIS_DOMINANCE_FACTOR = 0.7×` multiplier
  applied to the final `effDominance` (threaded through a new internal
  `dominanceMultiplier` option on `MeAttributionOptions` so the
  relaxation reaches the zero-bleed bar too — at bleed=0 the relaxed bar
  is 0.7×). The cursor slides forward on each rescue, so a chain of
  marginal words can be rescued from one Me anchor — but a 2-second
  remote run breaks the chain. Runs *before* V075's filler-inherit pass
  and V073's median filter so those passes see the hysteresis-corrected
  sequence; the V075 ROADMAP_03 invariant (fillers inherit from a
  coherent non-filler run) holds. The mic floor is **not** relaxed
  (silence still loses), so true remote runs flip off Me cleanly via
  the floor check.
- **Tests + regression guard** (block 03). New
  `tests/me-attribution-mic-priority.test.ts` (6 cases) pins zero-bleed
  lenient classification, full-bleed strict rejection under speakers
  mode, hysteresis stickiness inside the window, hysteresis time-out
  beyond it, hysteresis non-bridging across true remote runs (mic-floor
  gates), and the user-visible coalescence into one `"Me"` segment.
  Existing `me-attribution-bleed.test.ts` median-filter case re-tuned —
  the burst is concentrated on a single frame inside the borderline
  word only, so adjacent words don't bleed-flip Me under the new 1.0×
  baseline. Existing `me-attribution.test.ts` dominance-ratio gate
  replaced with explicit V076-baseline cases (mic-below-sys rejects;
  mic-at-sys accepts at zero bleed). The existing
  `deepgram-parse.test.ts` channel-0 → "Me" cases serve as the V075
  stereo regression guard — no new file needed.
- **Stereo "Best quality" (V075/04) unaffected** — channel-0 → "Me"
  is by construction in `parse.ts` and bypasses all V076 logic.
- 288 / 288 tests passing (was 281 + 7 new/re-tuned). No DB migration,
  no IPC contract change, no payload-shape change, no new Settings
  surface — pure-function delta inside `me-attribution.ts`. Holds
  §1.1 (energy timeline still scalar RMS); §1.2–§1.7 unchanged.

**v0.7.5 — diarization & transcript fidelity (shipped)**
- **`paragraphs=true` on the Deepgram stream** (block 01). Deepgram's
  paragraph boundaries are explicitly diarization-aware ("influenced by
  speaker changes"), giving us a second-order boundary signal V073's
  auto-merge was re-inventing from word-rate heuristics. Each word now
  carries a `paragraphIndex` (`-1` sentinel when paragraphs aren't in the
  message so the legacy / no-paragraphs path stays bit-identical to V073).
  A new `tests/deepgram-query.test.ts` pins the **full** query-string set so
  silent param drift — like V05's `detect_language` regression that broke
  nova-3 streaming with HTTP 400 — surfaces immediately.
- **Paragraph-aware grouping & remote-fragment merging** (block 02).
  `autoMergeAdjacentSpeakers` gains a same-paragraph fast-path: two
  adjacent remote fragments inside the same Deepgram paragraph merge
  unconditionally (skip the V073 word-rate / 800 ms-gap / ≥3-words
  heuristic). Long single-speaker monologues that span paragraphs emit one
  segment with `paragraphBreaks: number[]` (character offsets) so the
  renderer can show an internal blank-line break for readability. Additive
  migration v13 adds `paragraph_breaks_json` to `transcript_segments`
  (shared with block 03's `word_spans_json`). Streaming stays on Deepgram's
  v1 diarizer — the new `diarize_model=v2` is **pre-recorded only** and
  returns HTTP 400 on streaming; v1's the only option until Deepgram lifts
  that restriction.
- **Filler words capture & subdued UX** (block 03). `filler_words=true`
  (English-only — gated on `language=en*` or auto/multilingual) preserves
  the seven canonical fillers (`uh, um, mhmm, mm-mm, uh-uh, uh-huh,
  nuh-uh`) Deepgram otherwise strips. Each word carries `isFiller`;
  `attributeWords` runs a new pre-pass so short isolated fillers (≤200 ms)
  inherit their nearest non-filler neighbour's `isMe` instead of running a
  noisy per-word dominance check on a 100 ms "uh". `groupAttributedWords`
  records filler offsets as `wordSpans` so the renderer wraps each filler
  in `italic text-muted-foreground` — transcript fidelity wins without
  fillers stealing visual focus. New KV setting
  `transcript_include_fillers` (default **on**) + Zod-validated IPC channel;
  Settings → Transcription gets an Include / Strip toggle. When off, fillers
  are dropped at the parser stage (so the 5 fillers Deepgram returns even
  without the flag are also stripped).
- **Opt-in stereo "Best quality" capture mode** (block 04). The
  pre-V05 2-channel capture path is reinstated behind a new
  `captureQuality` setting. Cost-saver (default) keeps the V05 mono
  pipeline unchanged. **Best quality** runs Deepgram's "combine both"
  recommendation from `docs/multichannel-vs-diarization`:
  `multichannel=true` + `diarize=true` with mic on channel 0 (always "Me"
  — no heuristic) and system on channel 1 (Deepgram-diarized for remote
  speakers). The worklet gains an `outputChannels: 1 | 2` processor option
  and emits interleaved `[mic0, sys0, mic1, sys1, …]` PCM in stereo mode;
  the rest of the legacy parser path
  (`parse.ts:64-75` ch0 → "Me", `splitBySpeaker` → "Speaker N") is
  unchanged. Trade-off is ~2× billed Deepgram channels — surfaced in
  Settings → Audio with a clear cost helper, and the V073 "Listening on"
  row auto-disables (stereo eliminates bleed at the source). Holds §1.1 —
  stereo audio still never touches disk.

**v0.7.4 — UI polish (shipped)**
- **Softer AI button accent.** The `variant="ai"` button (Ask-across-notes,
  Chat, Optimize-with-AI) was a bold teal→blue gradient with white text — it
  competed with the solid-teal **New Note** and **Start** CTAs for first
  attention. V074 recoloured it as a soft tinted gradient with primary-coloured
  label and icon, so the primary CTAs win the visual hierarchy and the AI
  variant reads as the accent it's meant to be.
- **Settings as vertical tabs.** The 11-section single-scroll Settings modal
  became a left-rail tab navigator (General / AI / Audio / Transcription /
  Calendar / Templates / Updates / Usage & Cost / Data / Privacy). Language
  moved from Audio to General so it sits with the other global preferences;
  the destructive "Wipe all local data" is isolated under Privacy. State stays
  hoisted so switching tabs preserves in-progress edits (API-key reveal flow,
  the unsaved instructions textarea, etc.); the last-opened tab persists in
  `localStorage`.
- **Templates as a full-screen workspace.** Templates were one of the
  strongest features but lived as a sub-Dialog stacked on top of Settings.
  V074 moved them to a top-level page (Back ← / Templates / + New header,
  scrollable list on the left, large editor on the right with the snippet
  toolbar + Optimize-with-AI). Settings → Templates is now a single
  "Manage templates" entry point that opens the workspace and closes
  Settings. The reusable `<TemplateEditor>` body is shared with the legacy
  `TemplateEditorModal` so per-meeting edits stay one-click.
- **Customisable sidebar with per-section scroll.** New Note, Search, and
  Ask-across-notes are pinned at the top. The four lower sections —
  Folders, Tags, Agenda, Notes — can be hidden, reordered, and now each get
  their own bounded scroll container (no more pushing the meetings list
  off-screen with a long folder/tag list). A new "Edit sidebar" panel
  (`SlidersHorizontal` icon, bottom of the sidebar) opens checkboxes + ↑↓
  reorder + Reset; the last visible section's hide checkbox is disabled so
  users can never lock themselves into an empty sidebar. Layout persists in
  `localStorage` (`nexus:sidebar:layout`) — no DB migration, no IPC change.
- **About dialog cleanup.** Removed the "Releases" and "Source" outlinks —
  the V07 auto-updater makes the Releases link redundant and the repo
  shouldn't be linked from the consumer UI. Only "Check for updates" remains.
- **Typed-WIPE confirmation for destructive wipe.** A misclick after the
  single `window.confirm()` would wipe every meeting, transcript, note,
  template, and API key. V074 replaces that gate with a dedicated dialog —
  the user has to type the literal word `WIPE` (case-sensitive) before the
  destructive button enables. The wipe IPC itself is unchanged.

**v0.7.3 — transcription quality & bullet-proof Windows audio capture (shipped)**
- **Capture reliability on diverse Windows hardware.** The mic acquisition path
  now falls back layered (`{exact: id}` → `{ideal: id}` → system default) so a
  stale stored deviceId (Bluetooth reconnect, USB replug) can no longer silently
  fail; `CaptureProbe` surfaces *which* step won. The system loopback grant
  tries `screen` → `window` → audio-only (Electron 33 accepts
  `{ audio: 'loopback' }` with no video) so RDP / HDMI-only setups stop returning
  empty source lists. If even that fails, main pushes `audio:loopbackDenied`
  to the renderer and a non-blocking warning banner explains what to fix.
- **Sample-rate negotiation.** The AudioContext is no longer hard-pinned to
  16 kHz (Bluetooth A2DP and certain Realtek drivers silently came up at
  44.1 / 48 kHz and shipped wrong-rate PCM). The worklet now reads the
  context's actual rate and linear-decimates to 16 kHz before framing —
  pass-through when they match.
- **In-meeting silence watchdog.** After a 3 s grace, if the mic or system
  side hasn't produced any signal, a `transcription:warning` push lights up an
  inline banner ("No microphone signal detected — check Settings → Audio");
  auto-clears when signal returns.
- **Bleed-aware "Me" attribution.** `computeBleedScore` measures the rolling
  10 s normalised cross-correlation of mic vs system RMS envelopes; the
  dominance threshold and mic floor scale up with the score (×1.5 → ×4.5 at
  full bleed), so laptop-speaker calls stop mis-tagging remote speakers as
  "Me". A 1-word median filter kills single-word interjection artefacts
  (`"Yeah."` getting stamped Me mid-monologue) without touching real ones.
- **"Listening on" Settings toggle**: Auto / Headphones / Speakers — Auto
  uses the live bleed score; Headphones clamps it to 0; Speakers floors it
  at 0.5. Persisted as `audio_capture_mode` in the existing KV settings
  table (no migration).
- **Auto-merge adjacent remote fragments.** When `groupAttributedWords` emits
  consecutive remote segments differing only by Deepgram speaker ID, with a
  gap < 800 ms, ≥3 words each, and word rates within ±25 %, they collapse
  into one segment. Single-word backchannels (synthetic-test-fixture-shaped
  or real "Right.") are skipped so the merge is conservative.
- **Roadmap saved as `roadmap/V073/`** per the new doc convention — every
  approved plan now lives on-repo as `ROADMAP_00_INDEX.md` plus per-block
  files, written *before* the release commit.

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
| `roadmap/V073/…` | Transcription quality & bullet-proof Windows audio capture (shipped): mic + loopback fallback chains, in-worklet sample-rate decimator, in-meeting silence watchdog, bleed-aware "Me" attribution + Auto/Headphones/Speakers toggle, adjacent-fragment auto-merge. |
| `roadmap/V074/…` | UI polish (shipped): softer AI button accent, vertical-tab Settings, full-screen Templates workspace, customisable sidebar with hide/reorder + per-section scroll, About cleanup, typed-WIPE double-confirm for the destructive wipe-data action. |
| `roadmap/V075/…` | Diarization & transcript fidelity (shipped): `paragraphs=true` + `paragraphIndex` on every word, paragraph-aware grouping that collapses fragmented remote-speaker runs (migration v13), `filler_words=true` with subdued rendering + short-filler attribution inheritance, opt-in stereo Best-quality capture mode (`multichannel=true` + `diarize=true` per Deepgram's combine-both guidance). |
| `roadmap/V076/…` | Bleed-aware mic-priority "Me" attribution (shipped): zero-bleed dominance baseline dropped from V073's 1.5× to a lenient 1.0× interpolating up to a 4.0× full-bleed cap, plus 1.5 s Me-run hysteresis so brief mic-energy dips don't fracture a coherent Me utterance. Pure-function delta in `me-attribution.ts` — no migration, no IPC change, stereo path unaffected. |
| `scribe/docs/CALENDAR_SETUP.md` | One-time Google / Microsoft OAuth client setup. |

**Ground truth is the code, not the docs.** Where any doc disagrees with the
repository, the existing code wins — except the `CLAUDE.md` §1 invariants, which
are non-negotiable.
