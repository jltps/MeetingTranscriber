# CLAUDE.md

Build conventions and guardrails for this repository. Read `PRODUCT_SPEC.md`
first — it is the source of truth for *what* to build. This file is *how* to
build it. When the two ever disagree, `PRODUCT_SPEC.md` wins on product
decisions; this file wins on code conventions.

---

## 0. Orientation (read before writing code)

- This is **Scribe**: a bot-free, device-audio meeting notepad for **Windows**
  (Electron + React + TypeScript). It transcribes the full meeting by capturing
  system audio + mic, never joins the call, and never stores audio.
- Build strictly in the **milestone order** in `PRODUCT_SPEC.md` §12 (M0→M6).
  Do not jump ahead. Each milestone must be independently runnable.
- The **riskiest** subsystem is audio capture (M1). Prove it works end-to-end
  before building UI polish. If asked to "just build the app," still start at M0
  and stop after each milestone for review.

## 1. The non-negotiable rules

These are correctness/safety invariants, not style preferences. Never violate
them, even if a task seems to ask for it — flag the conflict instead.

1. **No audio is ever written to disk.** No recording files, no full-session
   buffers, no temp `.wav`. Audio frames exist in memory only long enough to be
   sent for transcription, then are dropped. There is no audio table and no save
   path. (`PRODUCT_SPEC.md` §6.4, §7.)
2. **API keys never reach the renderer in plaintext and never get logged.**
   Store via Electron `safeStorage`. Anthropic calls and (preferably) the
   Deepgram socket originate in the **main process**.
3. **Renderer is untrusted.** `contextIsolation: true`, `nodeIntegration: false`,
   `sandbox: true`. No Node APIs in the renderer. All privileged work crosses a
   typed IPC bridge.
4. **No bot, no meeting-platform integration.** We only touch OS audio. Do not
   add Zoom/Teams/Meet SDKs or APIs.
5. **The user's notes are sacred.** Enhancement may expand them, never delete or
   silently rewrite them. AI text the user edits becomes user-owned.

If a requested change would break one of these, stop and say so.

## 2. Tech stack (do not substitute without being asked)

- Electron (latest stable, **≥ v31** — required for loopback audio), pinned.
- React 18 + TypeScript (`strict: true`) + Vite.
- Tailwind CSS for styling.
- TipTap (ProseMirror) for the notes editor.
- `better-sqlite3` for local storage (main process only).
- Web Audio API + AudioWorklet for capture/mix/resample.
- Deepgram streaming (WebSocket) for transcription, behind the
  `TranscriptionSession` interface.
- Anthropic Claude API for enhancement, behind the `Enhancer` interface.
- Zod for runtime validation of all IPC payloads and all LLM JSON output.
- `electron-builder` (NSIS) — only at M6.

Use **pnpm**. Pin versions. Prefer the platform/standard library over adding a
dependency; justify any new dependency in the PR description.

## 3. Project structure

```
.
├─ CLAUDE.md
├─ PRODUCT_SPEC.md
├─ package.json
├─ electron.vite.config.ts
├─ src/
│  ├─ main/                     # Electron main process (privileged)
│  │  ├─ index.ts               # app/window lifecycle, security hardening
│  │  ├─ ipc/                   # ipcMain handlers, one file per domain
│  │  ├─ db/                    # better-sqlite3: schema, migrations, queries
│  │  ├─ audio/                 # display-media loopback handler, device mgmt
│  │  ├─ transcription/         # TranscriptionSession impls (Deepgram), relay
│  │  ├─ enhancer/              # Enhancer impl, prompt.ts (versioned)
│  │  └─ secrets/               # safeStorage wrappers for API keys
│  ├─ preload/
│  │  └─ index.ts               # contextBridge: exposes typed window.api only
│  ├─ renderer/                 # React app (untrusted)
│  │  ├─ main.tsx
│  │  ├─ app/                   # routing, layout, providers
│  │  ├─ features/
│  │  │  ├─ meetings/           # sidebar list, search
│  │  │  ├─ notes/              # TipTap editor, myNote/aiNote marks
│  │  │  ├─ transcript/         # live transcript panel
│  │  │  └─ settings/           # keys, devices, privacy
│  │  ├─ audio/                 # capture, ChannelMerger, AudioWorklet glue
│  │  │  └─ worklets/           # resampler.worklet.ts
│  │  └─ lib/                   # shared renderer utils
│  └─ shared/                   # types shared across processes (NO node/electron imports)
│     ├─ types.ts               # TranscriptSegment, EnhancedNotes, etc.
│     └─ ipc-contract.ts        # channel names + Zod schemas for every IPC call
└─ tests/
```

Rules about structure:
- `src/shared/**` must import nothing from `electron`, `node:*`, or React. It is
  pure types + Zod schemas, importable from any process.
- Never import `src/main/**` from the renderer or vice versa. They communicate
  **only** through the preload bridge using channels declared in
  `src/shared/ipc-contract.ts`.
- One feature = one folder under `renderer/features`. Keep components, hooks, and
  local state for that feature together.

## 4. IPC contract discipline

- Every IPC channel is declared once in `src/shared/ipc-contract.ts` with a Zod
  schema for its request and response.
- `ipcMain` handlers validate input with the schema before doing anything.
- The preload bridge exposes a single typed object: `window.api`. No raw
  `ipcRenderer` in the renderer. No dynamic channel names.
- Audio PCM frames are the one high-frequency channel — keep their payload a
  transferable (`ArrayBuffer`), and do not validate per-frame with Zod (validate
  the start/stop control messages instead).

## 5. Coding conventions

- TypeScript `strict`. No `any` (use `unknown` + narrowing). No non-null `!`
  unless provably safe with a comment.
- Functional React components + hooks. No class components.
- Naming: components `PascalCase`, hooks `useCamelCase`, files for components
  `PascalCase.tsx`, everything else `kebab-case.ts`.
- Keep modules small and single-purpose. Audio, transcription, and enhancement
  each stay behind their interface (`PRODUCT_SPEC.md` §6.2, §9) — UI code never
  imports a concrete provider, only the interface + a factory.
- Async: prefer `async/await`; always handle rejection. Sockets and the
  AudioContext must have explicit teardown on stop/unmount — leaks here mean the
  mic stays hot, which is unacceptable.
- Errors: fail loud in dev, degrade gracefully in UI. Surface transcription/LLM
  failures to the user; never silently swallow.
- No `console.log` in committed code — use a small logger that is guaranteed
  never to log audio bytes or API keys.

## 6. Audio subsystem rules (highest care)

- All capture/mix/resample lives in `renderer/audio`. The loopback grant lives in
  `main/audio`. Nowhere else.
- On stop or component unmount: stop every `MediaStreamTrack`, close the
  `AudioContext`, close the Deepgram socket, null out buffers. Verify the mic
  indicator goes off.
- Always request loopback as channel 1 and mic as channel 0 (see multichannel
  strategy, `PRODUCT_SPEC.md` §6.3) so "Me vs them" attribution is deterministic.
- The capture module must be swappable: if the Electron loopback path fails, a
  native WASAPI addon can replace `main/audio` without touching the renderer
  interface. Do not build the native addon unless the Electron path is proven to
  fail (it is explicitly out of scope for v1 otherwise).

## 7. Database rules

- `better-sqlite3` runs in the main process only; the renderer reaches it via IPC.
- Use migrations from day one (a simple numbered-SQL migration runner is fine).
  The schema in `PRODUCT_SPEC.md` §11 is the M0 baseline.
- `ON DELETE CASCADE` for meeting children; deleting a meeting wipes its notes and
  transcript. The "wipe all data" Settings action must leave nothing behind.

## 8. LLM / enhancement rules

- Model: current Anthropic Sonnet. Prompt lives in `main/enhancer/prompt.ts`,
  versioned with a comment header.
- Output is **strict JSON** matching `EnhancedNotes` (`PRODUCT_SPEC.md` §9),
  validated with Zod. On invalid JSON: retry once, then fall back to a plain
  markdown enhancement and mark it as a degraded result in the UI.
- For long transcripts, chunk and summarize-then-merge rather than truncating.
- Never send audio to the LLM. Only transcript text + user notes.

## 9. Testing

- **M1 is validated manually** with on-screen VU meters per channel + a raw
  transcript dump — automated tests can't prove real loopback capture.
- Unit-test the pure pieces: the resampler math, IPC Zod schemas, the
  enhancer JSON parser/validator, DB queries (against an in-memory SQLite).
- Add a Playwright smoke test for the renderer once M3 exists (create note → type
  → see it persist after reload). Keep it lightweight.
- Don't chase coverage numbers; cover the audio resampler, the enhancer parser,
  and the IPC contract because those break silently.

## 10. Git & workflow

- Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`).
- One milestone per branch (`m1-audio-capture`, `m2-transcription`, …). Keep PRs
  reviewable; don't bundle milestones.
- Each PR description states: which milestone, how it was verified, any new
  dependency + why, and confirmation that the §1 invariants still hold.
- Never commit secrets, `.env` with real keys, or any audio fixture. Add a
  `.gitignore` covering `node_modules`, `dist`, `out`, `*.sqlite`, `.env*`.

## 11. Commands (define these in package.json at M0)

```
pnpm install         # install
pnpm dev             # run Electron + Vite in watch mode
pnpm typecheck       # tsc --noEmit, must pass before any PR
pnpm lint            # eslint, must pass before any PR
pnpm test            # unit tests
pnpm build           # electron-builder NSIS (M6 only)
```

`pnpm typecheck` and `pnpm lint` must be clean before considering any task done.

## 12. When you're unsure

- If a task is ambiguous, ask before generating large amounts of code — don't
  guess at product behavior. Cross-check against `PRODUCT_SPEC.md`.
- If something seems to require violating a §1 invariant, stop and surface it.
- If a v2 feature (calendar, templates, chat, sync, offline Whisper, macOS) gets
  requested mid-v1, confirm it's intended scope before building — it's parked in
  `PRODUCT_SPEC.md` §13 for a reason.
