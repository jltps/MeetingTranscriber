# ROADMAP_00_INDEX.md

The **V07 backlog — In-App Auto-Update from GitHub Releases.** v1→V06 shipped capture,
transcription, enhancement, organization, the UI/UX rebrand, transcription
quality/cost, and the templates + AI-capabilities phase. V07 closes a long-standing
distribution gap: today every Nexus install is a dead-end — there is no way for
the app to discover a new version or update itself. Users have to find the latest
installer somewhere, run it manually, and trust that it does the right thing.

**Where things actually stand:**

- `scribe/electron-builder.yml` already declares `publish: provider: generic, url:
  https://nexus-web.vercel.app/api/updates/`.
- `pnpm dist` already chains `scripts/write-latest-yaml.mjs`, which produces
  `scribe/release/latest.yaml` (version, sha512, size, releaseDate, path) — both
  `latest.yaml` and electron-builder's native `latest.yml` are now tracked in git.
- BUT: there is **no `electron-updater` dependency**, **no main-process updater
  code**, **no IPC channels**, **no UI**, and **no CI**. The Vercel endpoint
  pointed at by the publish block has not been verified to actually serve the
  manifest + installer. Releases today are built locally and uploaded by hand.

V07 takes the decision (per planning) to make **GitHub Releases the source of
truth** rather than the generic-Vercel feed, and to ship the in-app update flow
end-to-end with an automated release pipeline.

> **Hold the §1 invariants exactly.** §1.1: nothing here touches audio. §1.2: no
> API keys involved (the GitHub Releases provider needs no token for a public
> repo; if the repo ever moves private, see block 03 future-work — never bake a
> token into the client). §1.3: every new IPC channel is Zod-validated in main;
> the renderer can only *request* an install via IPC — it cannot drive
> `autoUpdater` directly. §1.5: **the user's notes are sacred — never
> auto-restart while a meeting is being recorded**; defer install until the
> meeting ends. §1.6/§1.7: enhancement and language paths are not touched.

## The blocks

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | Updater Engine | Add `electron-updater`, switch publish provider to `github`, wire the main-process state machine (check → download → installable), add IPC contract, switch NSIS to `oneClick: true` for silent updates, add the recording-in-progress install guard | Engine + build config |
| 02 | Updater UI | Non-intrusive in-app banner ("Update ready — restart to install") + Settings → Updates panel (auto-update toggle, "Check now", current version, last-checked, status) + small About dialog showing version & link to Releases | UI + IPC consumer |
| 03 | Release CI | `.github/workflows/release.yml` building on Windows runner on tag `v*.*.*` push, uploading installer + `latest.yml` + blockmap to the corresponding GitHub Release; docs update in CLAUDE.md §11 + README | CI + docs |

## Dependencies

```
V06 (shipped)
  └─► 01 Updater engine ── adds electron-updater, GitHub provider, IPC channels,
        │   NSIS oneClick switch, recording-in-progress install guard. Foundational.
        │
        └─► 02 Updater UI ── consumes the IPC channels from 01: banner, Settings
              panel, About dialog. Pure renderer + preload bridge work.

03 Release CI ── independent in code; user-facing chain only "completes" once both
      01+02 are shipped AND a tagged release lands on GitHub via the workflow.
      Can land before, alongside, or after 01/02.
```

## Suggested order

1. **01 Updater engine** first — foundational. The IPC contract and provider
   switch land before any UI consumes them. Unit-testable in pieces (state
   machine, recording-guard logic).
2. **02 Updater UI** next — banner + Settings + About on top of 01's IPC. Can
   ship in the same release as 01 once the engine is verified end-to-end against
   a GitHub Release made by hand.
3. **03 Release CI** — can land independently. Recommended to ship it together
   with 01 so the first version published via the workflow is also the first
   version that has the in-app updater wired (cleaner cutover).

## Cross-cutting notes (hold across every block)

- **GitHub Releases is the source of truth.** Tag pushes produce releases; the
  app polls `gh-releases` for the repo. The generic-Vercel publish URL in
  `scribe/electron-builder.yml` is replaced (not duplicated). The Vercel-only
  manifest writer `scripts/write-latest-yaml.mjs` becomes redundant — block 01
  removes it (electron-builder writes `latest.yml` natively when `publish` is
  `github`, with the correct shape `electron-updater` expects).
- **Silent updates require `oneClick: true`.** Block 01 changes the NSIS config
  from `oneClick: false` to `oneClick: true`. Tradeoff: the first install also
  becomes silent (no install-dir picker). Per-user install stays the default, so
  this does not require elevation. Document the tradeoff in CLAUDE.md.
- **Recording-in-progress install guard (§1.5-adjacent).** Auto-download is
  always allowed; the *install* (`quitAndInstall`) is gated. If a meeting is
  recording when the user clicks "Restart to install" — or when the app would
  otherwise auto-install on quit — block install with a friendly message and
  retry after the meeting stops. The transcription IPC layer already knows
  whether a session is active (`session != null` in
  `scribe/src/main/ipc/transcription.ts`); expose a small accessor for the
  updater to consult.
- **Dev-mode guard.** Skip all update checks when `app.isPackaged === false`.
  Never call `autoUpdater` against `gh-releases` from a dev build.
- **Settings storage is key-value** (`scribe/src/main/db/settings.ts` —
  `settings(key TEXT PRIMARY KEY, value TEXT)`). The two new keys
  (`auto_update_enabled`, `update_last_checked`) need **no DB migration** —
  additive use of the existing table.
- **Code signing stays disabled** for V07 (it has been intentionally off; see
  `electron-builder.yml` `signAndEditExecutable: false`). Updates still work
  unsigned, but Windows SmartScreen continues to warn users on first install.
  Block 03 records "code-signing certificate procurement + sign-in-CI" as a
  named future-work item; not in V07 scope.
- **No GitHub token in the client.** The `github` provider works against a
  public repo with no token. If the repo is ever made private, the updater would
  need a token — that path is **not supported** in V07 (would require a server
  proxy or revisiting the generic feed approach).
- **No telemetry beyond existing logger.** Update events log via
  `scribe/src/main/logger.ts` (info-level; never log keys or audio). No new
  analytics surface.

## How to use a block with Claude Code

Feed the block file plus the codebase. Same discipline as V05/V06/V062: read
existing code, propose the fit before writing, ship as its own commit directly
to `main` (per CLAUDE.md §10 + memory `commit-to-main`), hold the §1 invariants,
and keep `corepack pnpm typecheck/lint/test/build` green. For block 01 verify
end-to-end against a hand-made GitHub Release before declaring done; for block
03 verify against an actual tag push.
