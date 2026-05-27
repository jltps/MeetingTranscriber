# Scribe

A **bot-free, device-audio meeting notepad for Windows**. Scribe transcribes your
whole meeting by capturing your computer's audio + microphone locally — it **never
joins the call** as a participant and **never stores audio**. You jot rough notes
during the call; afterwards an LLM fleshes them out from the full transcript,
keeping a clear visual line between what *you* wrote and what the AI added.

> Modeled on Granola. The defining promise: **capture the full meeting transcript
> with no meeting agent/bot**, working with any conferencing tool (Zoom, Teams,
> Meet, Slack huddles, plain VoIP) because it only listens to OS audio.

The app lives in [`scribe/`](scribe/). This file is the project overview; see the
[document map](#document-map) below for the spec, conventions, and build guide.

---

## Status

Shipping at **v0.3.0**. v1 (milestones M0–M6) is complete, and the post-v1
backlog is largely built:

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

Not yet built: transcript/enhancement quality eval loop (ROADMAP_03) and the
sync/sharing phases of the data block (ROADMAP_04).

## Tech stack

- **Electron 33** + **React 18** + **TypeScript** (strict) + **Vite**
  (`electron-vite`).
- **Tailwind CSS** for styling, **TipTap** (ProseMirror) for the notes editor.
- **better-sqlite3** for local storage (main process only).
- Web Audio API + **AudioWorklet** for capture/mix/resample to 16 kHz.
- **Deepgram** streaming (cloud) or local **Whisper** for transcription, both
  behind one `TranscriptionSession` interface.
- **Anthropic Claude** (`claude-sonnet-4-6`) for enhancement, titles, and chat,
  behind the `Enhancer` interface — always called from the main process.
- **Zod** for runtime validation of every IPC payload and all LLM JSON output.

## Privacy invariants (non-negotiable)

1. **No audio is ever written to disk** — frames live in memory only long enough
   to be transcribed, then are dropped. There is no audio table and no save path.
2. **API keys never reach the renderer in plaintext and are never logged.** Stored
   via Electron `safeStorage` (Windows DPAPI); network calls originate in main.
3. **Renderer is untrusted** — `contextIsolation: true`, `nodeIntegration: false`,
   typed IPC bridge only.
4. **No bot, no meeting-platform integration** — Scribe only touches OS audio.
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
├─ BUILD_GUIDE.md       # how to build/extend Scribe with Claude Code
├─ reference/           # M1 audio capture reference (study, not source)
├─ roadmap/
│  ├─ v02/FEATURES_LANGUAGE_PROMPT_TEMPLATES.md   # language/prompts/templates
│  └─ v03/ROADMAP_*.md                            # post-v1 backlog blocks
└─ scribe/              # the application
   └─ src/
      ├─ main/          # Electron main: window, ipc/, db/, audio/, transcription/,
      │                 # enhancer/, chat/, calendar/, secrets/
      ├─ preload/       # contextBridge: typed window.api only
      ├─ renderer/      # React app: app/, features/, audio/, lib/
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
| `scribe/docs/CALENDAR_SETUP.md` | One-time Google / Microsoft OAuth client setup. |

**Ground truth is the code, not the docs.** Where any doc disagrees with the
repository, the existing code wins — except the `CLAUDE.md` §1 invariants, which
are non-negotiable.
