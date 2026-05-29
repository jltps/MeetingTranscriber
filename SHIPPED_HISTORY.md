# Shipped beyond v1

Per-roadmap historical reference for what's been built and *why* since the v1
ship. This file used to live as a section in `CLAUDE.md` ("Already shipped
beyond v1") — it grew past the 40 KB CLAUDE.md soft limit, so the prose moved
here. The `CLAUDE.md` still owns the **rules and conventions**; this file owns
the **changelog**.

Ground rule for using this list: **don't rebuild — extend the existing code.**
For full per-block plans, see the corresponding `roadmap/VXYZ/` folder.

Already shipped beyond v1 (don't rebuild — extend the existing code): language +
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
- **V076 — bleed-aware mic-priority "Me" attribution (shipped;
  `roadmap/V076`):** pure-function delta to
  `main/transcription/me-attribution.ts` that fixes the long-standing
  complaint of a quiet user being scattered into `Speaker N` runs during
  normal-volume conference calls. Three blocks. (1) **Bleed-interpolated
  dominance.** V073's `effDominance = dominance × (1 + 2 × bleed)`
  (1.5× → 4.5×) overshot at both ends: too strict at the zero-bleed
  common case (headphones / clean mic), and over-strict at the worst
  case. V076 reorients to `effDominance = DOMINANCE_AT_ZERO_BLEED +
  (dominance − DOMINANCE_AT_ZERO_BLEED) × bleed` with
  `DOMINANCE_AT_ZERO_BLEED = 1.0` and a `dominance`-overridable full-
  bleed cap (default `DOMINANCE_AT_FULL_BLEED_DEFAULT = 4.0`). Numeric
  trace: bleed=0 → 1.0×; bleed=0.5 → 2.5×; bleed=1.0 → 4.0×. The
  `applyCaptureMode` clamps stay V073's ('headphones' → 0, 'speakers' →
  ≥ 0.5, 'auto' → observed) so the speakers regime still enforces a
  ≥ 2.5× bar. The mic-floor `BLEED_FLOOR_GAIN = 1.0` is unchanged.
  (2) **Me-run hysteresis.** Once a word is classified Me, the next
  `HYSTERESIS_WINDOW_MS = 1500` ms of borderline non-Me words get
  re-evaluated with a `HYSTERESIS_DOMINANCE_FACTOR = 0.7×` multiplier
  applied to the **final** `effDominance` — threaded through a new
  internal `dominanceMultiplier` option on `MeAttributionOptions` so
  the relaxation reaches the zero-bleed bar (1.0 × 0.7 = 0.7×) and
  not just the full-bleed cap. The cursor slides forward on each
  rescue (a chain of marginal words can be rescued from one Me anchor)
  but a 2-second remote run breaks the chain. Runs **before**
  `inheritShortFillerAttribution` and `medianFilterIsMe` so V075
  ROADMAP_03 + V073 invariants hold; the mic-floor is **not** relaxed
  so silence still wins and true remote runs flip off Me via the
  floor check. (3) **Tests + stereo regression guard.** New
  `tests/me-attribution-mic-priority.test.ts` (6 cases) pins zero-bleed
  lenient classification, full-bleed strict rejection under speakers
  mode, hysteresis stickiness, hysteresis time-out, hysteresis non-
  bridging across true remote, and the end-to-end coalescence into one
  Me segment. Existing `me-attribution-bleed.test.ts` median-filter
  case re-tuned — the burst is concentrated on a single frame inside
  the borderline word only so neighbours don't bleed-flip Me under the
  new 1.0× baseline. Existing `me-attribution.test.ts` dominance-ratio
  gate replaced with explicit V076-baseline cases (mic-below-sys
  rejects at zero bleed; mic-at-sys accepts at zero bleed). The
  existing `deepgram-parse.test.ts` channel-0 → "Me" cases serve as
  the V075 stereo regression guard. 288 / 288 passing (was 281; +7
  net). **Stereo "Best quality" (V075/04) bypasses all V076 logic** —
  `parse.ts:116-127` maps channel-0 → "Me" by construction. No DB
  migration, no IPC contract change, no payload-shape change, no new
  Settings surface. Holds §1.1 (energy timeline still scalar RMS
  only); §1.2–§1.7 unchanged.
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
- **V08 — Gladia live STT + post-call audio intelligence (shipped):** see
  `roadmap/V08/`. Adds **Gladia** (`solaria-1`) as a third transcription
  provider beside Deepgram (default) and local Whisper, behind the existing
  `TranscriptionSession` interface and selectable in Settings → Transcription
  with its own `safeStorage`-encrypted key (`gladia_key_enc` / `GLADIA_API_KEY`).
  Implemented against the real `@gladiaio/sdk@1.0.4` (which differs from the
  in-folder implementation guide): `startSession()` is synchronous and the SDK
  reconnects internally, so — unlike `DeepgramSession` — there's no hand-rolled
  backoff; diarization/NER/sentiment are `realtime_processing` WebSocket messages
  plus a comprehensive `post_final_transcript`, so no separate REST fetch on the
  live path (a `GET /v2/live/:id` fallback exists only for boot-resume); there's
  no top-level `diarization` toggle (uses `utterance.speaker`); results carry no
  confidence; and language is ISO-639-1 so the app's BCP-47 is mapped
  (`pt-PT`→`pt`) — auto/unmappable leaves languages empty for auto-detect, never
  defaulting to English (§1.7). The whole SDK surface is confined to
  `main/transcription/gladia.ts` + the pure `parse-gladia.ts`; everything else
  consumes a normalized `MeetingInsights`. Live utterance finals flow through the
  existing `onSegment` path (segment-level energy "Me" recovery, same as
  Deepgram); a new optional `onInsights` callback on `TranscriptionSession`
  carries the post-call intelligence. Because insights arrive *after* `stop()`,
  the IPC layer (`ipc/transcription.ts`) keeps the Gladia session alive in an
  `enriching` set (marking the meeting "processing"), then reconciles
  "Me"/speaker against the persisted transcript (the energy timeline is cleared
  on stop) and stores a normalized blob in an additive **`meeting_insights`**
  table (migration **v14**, with a `meetings.stt_provider` column for
  provider-aware cost). UX lands both ways (guide §13): a dedicated post-call
  **Insights** view (`renderer/features/insights/`) rendered from Gladia's own
  utterances (speaker colour, inline NER tags, per-utterance sentiment, summary
  card) *and* an inline **weave** overlaying NER underlines + a sentiment glyph
  onto the live `TranscriptPanel` via a time-overlap + substring-match merge.
  Long calls get a seamless ~2.5 h **session handoff** (restart the WS with a
  cumulative timestamp offset; merge results across sub-session ids); a boot-time
  **resume** re-fetches insights interrupted by an app close. Backup bundle
  bumped to **v3** (per-meeting `insights` + `sttProvider`, default-null so v1/v2
  bundles still validate) with restore + a Markdown-export Insights section;
  Settings → Usage & Cost is provider-aware (new approximate Gladia per-minute
  constant). New deps `@gladiaio/sdk` + its `eventemitter3` peer (`ws` already
  present), externalized in the CJS main bundle. 324/324 tests pass (8 new V08
  files). Holds §1.1 (no audio on disk — frames go straight to the socket; the
  post-call result is server-side), §1.2 (key + the tokenized `wss://` URL stay
  main-side and unlogged), §1.5/§1.6 (insights are a separate table + view,
  never touching notes or the enhancer contract).

---

> **Maintenance note.** When a new VXYZ ships, add its summary at the bottom of
> the list above (NOT to CLAUDE.md). Keep the format consistent: lead with the
> roadmap folder reference, then prose summarising what changed and why, then a
> §1-invariants line. The runbook step in `CLAUDE.md` §11 that says "add to
> CLAUDE.md's 'Already shipped' list" now means **this file**.
