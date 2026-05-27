# BUILD_GUIDE.md — building Nexus with Claude Code

How to go from an empty folder to a packaged Windows build of Nexus, using
Claude Code as the implementer. This guide is the *process*; `PRODUCT_SPEC.md` is
*what* v1 was and `CLAUDE.md` is *how* the code should look.

> **Where the project is now.** v1 (milestones M0–M6) is **shipped**, most of the
> post-v1 backlog is too (language/templates, reliability, speaker naming,
> export/backup, local Whisper, calendar, cross-meeting chat), and **V04 — the UI/UX
> + rebrand phase — has shipped** (design tokens + theming, shadcn/ui, frameless title
> bar, folders/tags, command palette, window-state, onboarding, accessibility). The
> product was **renamed Scribe → Nexus** in V04; the `scribe/` directory and the
> `com.scribe.app`/`scribe.sqlite` identifiers are deliberately unchanged so existing
> data is preserved. Phases 1–3 below are the historical *bootstrap* record — useful
> for understanding the build discipline and re-reading a milestone before touching it.
> For extending the shipped app, jump to
> [Phase 5 — Beyond v1](#phase-5--beyond-v1-extending-the-shipped-app). The docs live
> at the repo root; the app lives in the **`scribe/`** subdirectory, so every
> `pnpm …` command below runs from `scribe/`.

---

## The one rule that matters most

**Build natively on Windows. Do not build inside WSL.**

This product captures Windows **system (loopback) audio** and opens a real
Windows GUI window. An Electron app launched from inside WSL has no display and
no access to Windows audio loopback, so `pnpm dev` will show you nothing useful.
Run **both** Claude Code and the app on native Windows 10/11.

(WSL is fine for unrelated projects — just not this one.)

## The discipline that makes it work

Build **one milestone at a time**: prompt → review the diff → run it → test →
commit → `/clear` → next milestone. Do **not** let Claude Code sprint through all
six milestones in one go. The failure mode is a beautiful UI sitting on top of an
audio pipeline that was never verified on real hardware. **M1 is a hard gate.**

---

## Phase 0 — Install prerequisites (once)

You need two separate toolchains: **Claude Code** (writes the code) and the
**Node/Electron toolchain** (runs the app). The native Claude Code installer does
not need Node, but the app does — install both.

1. **Git for Windows** — from https://git-scm.com. Install this *first*; it is the
   most common cause of Claude Code install failures on Windows, and Claude Code
   uses Git Bash under the hood.
2. **Node.js LTS** (to run the app). In PowerShell:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
   Then enable pnpm:
   ```powershell
   corepack enable
   corepack prepare pnpm@latest --activate
   ```
3. **Claude Code** (native installer, recommended). In PowerShell:
   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```
   Close and reopen the terminal, then verify:
   ```powershell
   claude doctor
   ```
4. **A paid plan.** Claude Code requires Pro, Max, Team, Enterprise, or Console
   access. The free Claude.ai plan does not include Claude Code.
5. **API keys for later** (not needed for M0/M1):
   - **Deepgram** key — transcription, used at M2.
   - **Anthropic** key — note enhancement, used at M4.
   Keep both **out of the repo**. They get pasted into the app's Settings screen
   at M5, never into source or `.env` committed to git.

**System check:** Windows 10 (1809+) or Windows 11; 8 GB+ RAM recommended.

> Verify exact, current install commands and OS requirements at
> https://docs.claude.com/en/docs/claude-code/overview — they change over time.

## Phase 1 — Lay out the project

In PowerShell:

```powershell
mkdir scribe
cd scribe
git init
```

Place the artifacts:

- `PRODUCT_SPEC.md` → repo root
- `CLAUDE.md` → repo root
  *(Claude Code auto-loads `CLAUDE.md` as standing context every session — that's
  why it's named that. Your invariants and conventions persist across sessions and
  even survive `/clear`.)*
- `BUILD_GUIDE.md` → repo root (this file)
- the `m1-audio-reference/` folder → `./reference/m1-audio-reference/`
  *(in `reference/` so Claude Code studies it without mistaking it for real source)*

Create a `.gitignore` before anything else:

```
node_modules/
dist/
out/
*.sqlite
.env*
```

Commit the starting point:

```powershell
git add -A
git commit -m "chore: project docs + M1 audio reference"
```

> **Note on the layout that actually shipped.** The repo settled on docs +
> `roadmap/` + `reference/` at the **repo root** and the Electron app in a
> **`scribe/`** subdirectory (so `pnpm` commands run from `scribe/`). If you're
> reading this against the live tree, that's the structure to match — not a
> single flat folder.

## Phase 2 — Start Claude Code and orient it

```powershell
claude
```

**First message — orient, don't build:**

> Read PRODUCT_SPEC.md and CLAUDE.md in full, and skim
> ./reference/m1-audio-reference. Don't write any code yet. Summarize the build
> plan, confirm the M0 deliverable and the §1 invariants, then stop and wait for
> me.

This guarantees the spec and rules are loaded before it touches anything. If the
summary is wrong, fix the misunderstanding now — not after 2,000 lines of code.

## Phase 3 — Build milestone by milestone

After each milestone: review the diff, run it, then
`git add -A && git commit -m "feat: M<n> …"`, then `/clear` before the next.

### M0 — scaffold
> Implement milestone M0 only — the Electron + Vite + React + TS scaffold with the
> hardened BrowserWindow, typed preload bridge, SQLite wired up, and the folder
> structure from CLAUDE.md §3. Use pnpm. When done, run `pnpm typecheck` and
> `pnpm lint`, fix anything, tell me how to run it, and stop.

Verify: `pnpm dev` opens a blank window with the sidebar/editor shell. Commit.

### M1 — audio capture  ← THE GATE
> Implement M1 by adapting ./reference/m1-audio-reference into our real structure.
> Reuse its loopback approach, the 2-input AudioWorklet, and the 16 kHz
> AudioContext exactly. Honor the no-audio-persistence rule. Update
> PRODUCT_SPEC.md §6.1/§6.3 to match the refinements noted in the reference
> README. Don't start M2.

**Verify on your own hardware before proceeding:** `pnpm dev`, then speak (CH0 /
mic meter moves) and play any audio or a real call (CH1 / system meter moves).
Confirm "saved to disk" stays at 0. **Do not move past M1 until CH1 works on your
machine** — every later milestone assumes this clean 2-channel PCM stream exists.
Commit.

### M2 — live transcription
> Implement M2: Deepgram streaming behind the §6.2 interface, multichannel +
> diarization, with the WebSocket opened from the MAIN process so the API key
> never reaches the renderer (§6.3). Live transcript panel with CH0 → "Me" and
> CH1 → diarized remote speakers. Stop after M2.

Verify: live transcript appears during a real call with correct "Me vs them"
labels. Commit.

### M3 — notes + persistence
> Implement M3: TipTap notes editor with autosave, the meeting list + create/stop
> lifecycle, transcript persistence, and FTS search in the sidebar per §11.

Verify: type notes, stop, restart the app — notes and transcript survive; search
finds them. Commit.

### M4 — enhancement
> Implement M4: Claude enhancement per §9 — strict JSON output validated with Zod,
> the my-notes vs AI-notes rendering (§8.3), and the rule that AI text the user
> edits flips to user-owned. Stop after M4.

Verify: stopping a meeting produces enhanced notes that visibly distinguish your
words from the AI's; editing an AI line reclassifies it as yours. Commit.

### M5 — source linking + settings
> Implement M5: source linking (§8.4, the magnifying-glass jump-to-transcript) +
> the Settings screen (§10) with safeStorage for the Deepgram and Anthropic keys +
> the first-run privacy notice.

Verify: clicking a source icon scrolls to the right transcript segment; keys are
stored encrypted (not plaintext, not in logs). Commit.

### M6 — package
> Implement M6: electron-builder NSIS packaging. Build it and confirm it runs.

Verify: install the produced build on a clean Windows 10/11 machine and run the
full happy path (§4) end to end. Commit and tag.

## Phase 4 — Working effectively with Claude Code

- **Plan mode for the big milestones (M2, M4).** Cycle input modes with
  **Shift+Tab** to a plan-only mode; review the plan before it writes code.
- **Clear context between milestones** with `/clear` (or `/compact` to keep a
  short summary). `CLAUDE.md` reloads automatically, so your rules persist.
- **Hold it to its own checks.** `CLAUDE.md` says `pnpm typecheck` and `pnpm lint`
  must pass before a milestone is "done." Enforce that before every commit.
- **Branch per milestone** for clean history (`git checkout -b m2-transcription`),
  matching CLAUDE.md §10. One milestone per PR.
- **Paste screenshots** with **Alt+V** (Ctrl+V only pastes text), or drag the
  image into the window — useful for debugging the audio meters or UI.
- **Guard the invariants (CLAUDE.md §1).** If Claude Code ever proposes saving
  audio to disk, putting an API key in the renderer, or adding a Zoom/Teams/Meet
  SDK, stop it. It should be refusing on its own — those are hard rules.
- **Keep prompts milestone-scoped.** Always end build prompts with "stop after
  M<n>." Scope creep across milestones is the main way quality degrades.

## Phase 5 — Beyond v1 (extending the shipped app)

v1 is built. New work comes from the post-v1 backlog, not from `PRODUCT_SPEC.md`:

- **`roadmap/v02/FEATURES_LANGUAGE_PROMPT_TEMPLATES.md`** — language + auto-detect,
  enhancement prompt control, templates. *(Shipped.)*
- **`roadmap/v03/ROADMAP_*.md`** — independent building blocks (reliability, speaker
  naming, quality, data/export/sync, local Whisper, calendar, cross-meeting). Read
  `ROADMAP_00_INDEX.md` first for the dependency order and status. Most are shipped;
  the quality eval loop (03) and the sync/sharing phases (04) are not.
- **`roadmap/v04/ROADMAP_*.md`** — the UI/UX + rebrand phase (design tokens + theming,
  shadcn/ui component system, frameless app shell, folders/tags, command palette,
  layout/window-state, onboarding, accessibility, and the Nexus rebrand). *All shipped.*
  UI-only — no block changed audio/transcription/enhancer/calendar or any §1 behavior.

The same discipline that built v1 still applies — only the anchor document changes:

1. **One block per branch** (`feat/<block>`), matching `CLAUDE.md` §10. Keep PRs
   reviewable; don't bundle unrelated blocks.
2. **Read the existing code first.** v1's interfaces (`TranscriptionSession`,
   `Enhancer`) and the shared IPC contract are why these blocks are cheap — extend
   them, don't fork a second way of doing things (`CLAUDE.md` §0, §4).
3. **Propose the fit before writing.** Have Claude Code sketch how the block lands in
   the current structure (which files, which IPC channels, which migration) and
   review that before it writes code. Use plan mode (Shift+Tab) for the big ones.
4. **Migrations only — never recreate tables.** The DB now holds real meetings. New
   schema ships as additive, ordered migrations in `scribe/src/main/db/migrations.ts`
   (`CLAUDE.md` §7). Test migrations against a populated DB.
5. **Hold the §1 invariants every time.** No audio to disk, keys never in the
   renderer/logs, no bot/meeting-platform SDK, notes stay sacred. Calendar access is
   read-only **free/busy** only — it learns *when* you're busy, never event details.
6. **Gate on `pnpm typecheck` + `pnpm lint`** (run from `scribe/`) before every
   commit, same as v1.
7. **`/clear` between blocks.** `CLAUDE.md` reloads automatically, so the invariants
   and conventions persist.

Calendar blocks need a one-time OAuth client; point Claude Code (and yourself) at
`scribe/docs/CALENDAR_SETUP.md`.

## Quick reference

| Step | Command |
|---|---|
| Start Claude Code | `claude` |
| Health check | `claude doctor` |
| Clear context (keep CLAUDE.md) | `/clear` |
| Compact context | `/compact` |
| Plan-only mode | Shift+Tab |
| Paste screenshot | Alt+V |
| Run app (dev) | `pnpm dev` |
| Type/lint gates | `pnpm typecheck` · `pnpm lint` |
| Compile (no installer) | `pnpm build` |
| Package NSIS installer | `pnpm dist` |

## If something breaks

- **`claude` not recognized** — reopen the terminal; if still missing, the binary
  dir (`%USERPROFILE%\.local\bin`) isn't on PATH. Add it, or re-run the installer.
- **`pnpm dev` shows nothing / no audio** — you're almost certainly in WSL. Run on
  native Windows.
- **CH1 (system audio) meter flat** — the captured default output must match the
  device you actually hear the call on (*Settings → System → Sound → Output*); try
  built-in audio if using Bluetooth/USB. See the M1 reference README.
- **Mic blocked** — enable mic for desktop apps in *Settings → Privacy & security
  → Microphone*.
- **Claude Code drifts from the spec** — `/clear`, then re-anchor: "Re-read
  PRODUCT_SPEC.md §<n> and CLAUDE.md before continuing."
