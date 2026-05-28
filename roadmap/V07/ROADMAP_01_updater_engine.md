# ROADMAP_01 — Updater Engine (main process)

## Problem

Nexus has no way to discover or apply its own updates. A user who installed
0.6.1 stays on 0.6.1 forever unless they happen to find a newer installer
manually. The build side is partially wired (`electron-builder.yml` has a
`publish` block; `pnpm dist` writes `release/latest.yaml`), but the app itself
has zero updater code, no library, no IPC channels, no UI surface.

## Goal

Wire a working main-process updater that:

1. Checks GitHub Releases on app start and every N hours thereafter (default
   `N = 6`), only in packaged builds.
2. Auto-downloads any newer release in the background.
3. Emits a state machine to the renderer over IPC: `idle`, `checking`,
   `available`, `downloading` (with `percent`), `downloaded`, `error`, `none`.
4. Lets the renderer trigger an immediate "check now" and, once downloaded,
   trigger `quitAndInstall` — with a hard guard that **refuses to install while
   a meeting is being recorded**.

## Non-goals (explicitly out of scope)

- Any UI work — that's block 02.
- Any CI / release-pipeline work — that's block 03.
- Beta / pre-release channels (stable only).
- Delta-update size optimization beyond what electron-builder gives us by
  default (`.blockmap` is already generated).
- Code-signing the installer (intentionally off; see block 03 future-work).
- Differential rollouts, A/B updates, or remote kill-switches.
- Supporting a private GitHub repo (requires a token — explicitly unsupported).
- Moving the publish provider back to `generic` / Vercel.

## Approach

### Dependency

Add `electron-updater` to `scribe/package.json` `dependencies`. Pin to the
latest stable compatible with the project's Electron 33 — verify the version
during implementation against the electron-updater release notes; document the
chosen version + minor reason in the commit message.

### `electron-builder.yml` changes

- **Switch publish provider** from `generic` to `github`:
  ```yaml
  publish:
    provider: github
    owner: <gh-owner>           # resolve via `gh repo view` during implementation
    repo: <gh-repo>             # idem
    releaseType: release        # ignore drafts and prereleases
  ```
  electron-builder will write the correctly-shaped `latest.yml` (the format
  `electron-updater` consumes) directly into `release/` on `pnpm dist`. The
  hand-rolled `scripts/write-latest-yaml.mjs` becomes redundant — remove it,
  remove its invocation from the `dist` script in `package.json`, and remove
  the `release/latest.yaml` it produced (keep electron-builder's `latest.yml`).
- **Switch NSIS to silent installs**:
  ```yaml
  nsis:
    oneClick: true
    perMachine: false
    allowToChangeInstallationDirectory: false   # required when oneClick: true
    deleteAppDataOnUninstall: false             # keep user DB on update/uninstall
  ```
  Tradeoff documented in the commit message + CLAUDE.md §11 update: first-time
  installs become silent (no install-dir picker). This is the price of silent
  background updates and is the same UX as Slack/Discord/VS Code per-user
  installs.
- Keep `signAndEditExecutable: false` (no code signing in V07).
- Keep `artifactName` pattern unchanged so existing manifests still resolve.

### Main-process module: `scribe/src/main/updater/`

New directory mirroring sibling modules (`enhancer/`, `chat/`, `calendar/`).
Files:

- `scribe/src/main/updater/index.ts` — the updater state machine. Exports
  `initUpdater()` (called from `scribe/src/main/index.ts` after `app.whenReady`)
  and `disposeUpdater()` (called from the main `before-quit` / `disposeAll`
  path that already exists). Wraps `autoUpdater` from `electron-updater`.
  Responsibilities:
  - In `app.isPackaged === false`: log "updater disabled in dev" and return.
    No event wiring, no timer.
  - Configure `autoUpdater` (`autoDownload = true`, `autoInstallOnAppQuit =
    false` — we control install timing ourselves so the recording guard runs).
  - Subscribe to: `checking-for-update`, `update-available`, `update-not-
    available`, `download-progress`, `update-downloaded`, `error`. Translate
    each into the renderer state machine via `IPC.updateStatus` (see contract
    below).
  - Read `auto_update_enabled` from settings on init; if `false`, skip the
    boot-time check and the timer. The renderer's "check now" still works
    (manual override).
  - Schedule periodic checks: `setInterval(checkNow, 6 * 60 * 60 * 1000)`
    started 60 s after boot. Document the timing constants at the top of the
    file.
  - Persist `update_last_checked` (ISO string) to settings on every successful
    check (whether or not a new version was found).

- `scribe/src/main/updater/install-guard.ts` — single pure function:
  ```
  canInstallNow(): { ok: true } | { ok: false; reason: 'recording' }
  ```
  Returns `{ ok: false, reason: 'recording' }` when a transcription session is
  active. Pulls that signal from a small accessor exported by
  `scribe/src/main/ipc/transcription.ts` (add `export function
  isTranscriptionActive(): boolean { return session !== null; }`). The guard
  module is pure & unit-testable by injecting a `getActive` parameter; the
  default reads the accessor.

- `scribe/src/main/updater/__tests__/install-guard.test.ts` — verifies the
  guard returns the right answer for both states.

### IPC contract additions

Edit `scribe/src/shared/ipc-contract.ts`:

- Add channels:
  ```
  IPC.updateCheckNow      // renderer → main, returns { ok: true } | { ok: false; error: string }
  IPC.updateInstall       // renderer → main, returns { ok: true } | { ok: false; reason: 'recording' | 'not-downloaded' | 'error'; message?: string }
  IPC.updateGetState      // renderer → main, returns UpdateState (current snapshot)
  IPC.updateStatus        // main → renderer event, pushes UpdateState on every transition
  ```
- Add Zod schemas:
  ```
  UpdateStateSchema = z.discriminatedUnion('phase', [
    z.object({ phase: z.literal('idle') }),
    z.object({ phase: z.literal('checking') }),
    z.object({ phase: z.literal('available'), version: z.string(), releaseDate: z.string().optional(), releaseNotes: z.string().optional() }),
    z.object({ phase: z.literal('downloading'), version: z.string(), percent: z.number().min(0).max(100) }),
    z.object({ phase: z.literal('downloaded'), version: z.string(), releaseNotes: z.string().optional() }),
    z.object({ phase: z.literal('none'), checkedAt: z.string() }),
    z.object({ phase: z.literal('error'), message: z.string() }),
  ]);
  ```
- Validate inputs on every handler (request bodies are empty, but validate
  presence — CLAUDE.md §4 discipline).

### Preload bridge additions

Edit `scribe/src/preload/index.ts` to expose under `window.api.updates`:

```
updates: {
  checkNow(): Promise<{ ok: boolean; error?: string }>,
  install(): Promise<{ ok: boolean; reason?: string; message?: string }>,
  getState(): Promise<UpdateState>,
  onStatus(cb: (state: UpdateState) => void): () => void,   // returns unsubscribe
}
```

All four follow the existing typed-bridge conventions in this file (compare
existing exports like `window.api.meetings`, `window.api.chat`). No raw
`ipcRenderer` leaks into the renderer.

### Settings storage

No DB migration needed. Use the existing `settings` key-value table
(`scribe/src/main/db/settings.ts`):

- `auto_update_enabled` (default `'true'`) — read on init; written by block 02
  via its IPC handler.
- `update_last_checked` (ISO 8601 string) — written by the updater after every
  check.

Add `getAutoUpdateEnabled(): boolean` and `setAutoUpdateEnabled(v: boolean)`
helpers to `settings.ts` matching the existing helpers there (e.g.
`getQualityMode`/`setQualityMode`).

### Wiring into `scribe/src/main/index.ts`

After `await app.whenReady()` (and after the existing window-creation /
IPC-registration code), call `initUpdater()`. Add `disposeUpdater()` to the
existing teardown path (the file already disposes transcription, calendar,
etc. — match that pattern).

## Verification

### Unit tests

Add under `scribe/src/main/updater/__tests__/`:

1. **Install guard — recording active.** `canInstallNow({ getActive: () =>
   true })` → `{ ok: false, reason: 'recording' }`.
2. **Install guard — idle.** `canInstallNow({ getActive: () => false })` →
   `{ ok: true }`.
3. **State machine projection (pure).** A small helper that maps
   `electron-updater` event payloads to the wire `UpdateState` (e.g.
   `mapDownloadProgress({ percent: 42, ... })` → `{ phase: 'downloading',
   version, percent: 42 }`). Tested without spinning the real updater. Three or
   four representative inputs.
4. **Zod contract round-trip.** Every `UpdateState` variant parses cleanly
   through `UpdateStateSchema`; unknown phase rejected.

### Manual end-to-end

Requires a hand-made GitHub Release (block 03 automates this later):

1. Build a 0.6.2 installer locally with `corepack pnpm dist` (now writing
   electron-builder's native `latest.yml`).
2. On GitHub, draft a release tagged `v0.6.2`, upload `Nexus Setup 0.6.2.exe`,
   `latest.yml`, and `Nexus Setup 0.6.2.exe.blockmap`. Publish.
3. Install the previously-shipped 0.6.1 on a clean machine (or VM).
4. Launch 0.6.1. Within ~60 s the updater should check, download, and emit
   `downloaded`. Verify via main-process logs (`logger.info('update
   downloaded', ...)`).
5. With no meeting recording: trigger install via a dev-only debug button or
   directly via `window.api.updates.install()` in DevTools — app quits and
   relaunches as 0.6.2 silently.
6. Repeat the install step with a meeting recording → expect `{ ok: false,
   reason: 'recording' }`; stop the meeting; retry → succeeds.
7. With `auto_update_enabled = false`: boot 0.6.1, observe no automatic
   check; call `checkNow()` manually → still works.

### Type/lint/test/build gates

`corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test &&
corepack pnpm build` all clean before commit.

## §1 invariants — affirmation checklist for the commit

- **§1.1 No audio to disk / in memory.** Unaffected — updater is wholly
  unrelated to audio paths.
- **§1.2 API keys.** No keys touched. The `github` provider is anonymous
  against a public repo; no token is added to the client. (If the repo ever
  moves private, this whole approach must be revisited — flag explicitly.)
- **§1.3 Renderer untrusted.** Every new IPC channel is Zod-validated. The
  renderer cannot drive `autoUpdater` directly — it can only ask main to
  `checkNow` / `install` / `getState`, and receive `updateStatus` events.
- **§1.4 No bot / meeting integration.** Unaffected.
- **§1.5 User notes are sacred.** The recording-in-progress install guard
  protects against quitting mid-capture and losing live transcript state.
  Documented in the commit message.
- **§1.6 JSON contract.** Unaffected.
- **§1.7 Language behavior.** Unaffected.

State each invariant explicitly in the commit message per CLAUDE.md §10.

## Acceptance

- New `scribe/src/main/updater/` module with state machine + install guard +
  unit tests.
- `scribe/electron-builder.yml` switched to `provider: github` and `nsis.
  oneClick: true`.
- `scripts/write-latest-yaml.mjs` removed; `package.json` `dist` script no
  longer invokes it; `scribe/release/latest.yaml` removed (electron-builder's
  `latest.yml` remains).
- `scribe/src/shared/ipc-contract.ts` and `scribe/src/preload/index.ts` extended
  with the four update channels + bridge.
- `scribe/src/main/index.ts` calls `initUpdater()` after `whenReady` and
  `disposeUpdater()` on shutdown.
- Manual end-to-end verified against a hand-made 0.6.1 → 0.6.2 GitHub Release;
  recording-guard verified both paths.
- One commit, directly to `main`, Conventional Commits (`feat(updater): …`).
