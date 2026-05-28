# ROADMAP_03 — Release CI (GitHub Actions)

## Problem

Today Nexus releases are built locally with `pnpm dist` and uploaded to GitHub
Releases by hand. With block 01's `provider: github`, the in-app updater pulls
from those Releases — so a release that's missing `latest.yml` or the
`.blockmap` simply doesn't reach any user. Manual uploading is fragile (easy
to forget a file, easy to mis-name); a build environment that drifts from one
release to the next is worse.

## Goal

A GitHub Actions workflow that, on a tag push of the form `v*.*.*`, runs the
existing build on a Windows runner and publishes the installer + the
`electron-updater`-consumable manifests to the GitHub Release for that tag —
with no human steps after `git tag v0.7.0 && git push --tags`.

## Non-goals

- Cross-platform builds (Windows only — the app is Windows-only per
  CLAUDE.md §0).
- Code-signing certificate procurement or signing-in-CI (recorded as named
  future work; see "Deferred" below).
- Pre-release / draft / nightly channels.
- Auto-bumping the version (humans still edit `scribe/package.json`'s
  `version` and commit before tagging).
- Notarization (Windows; not applicable).
- Releasing the repo root (anything outside `scribe/`).

## Approach

### Workflow: `.github/workflows/release.yml`

A single workflow file at the **repo root** (`.github/workflows/release.yml`),
not under `scribe/`. Triggers and structure:

```yaml
name: Release
on:
  push:
    tags: ['v*.*.*']
permissions:
  contents: write          # required to upload assets to the Release
jobs:
  build:
    runs-on: windows-latest
    defaults:
      run:
        working-directory: scribe
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20             # confirm against scribe/package.json engines / current CI norms
      - run: corepack enable
      - run: corepack pnpm install --frozen-lockfile
      - run: corepack pnpm typecheck
      - run: corepack pnpm lint
      - run: corepack pnpm test
      - run: corepack pnpm dist
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
```

Notes on the shape:

- **`pnpm dist` does the publish.** With block 01's `publish: { provider:
  github, owner, repo }` in `electron-builder.yml`, electron-builder uploads
  the installer + `latest.yml` + `.exe.blockmap` to the GitHub Release for
  the matching tag automatically, using `GH_TOKEN`. No separate
  `actions/upload-release-asset` step needed.
- **Tag-to-version check.** Add a small step before `pnpm dist` that verifies
  the pushed tag's version (`v0.7.0` → `0.7.0`) matches
  `scribe/package.json`'s `version` field. Fail the job loudly on mismatch —
  prevents the common footgun of "I tagged but forgot to bump". Implement
  inline in PowerShell (the runner is Windows) reading `package.json` with
  `Get-Content … | ConvertFrom-Json`.
- **`CSC_IDENTITY_AUTO_DISCOVERY: 'false'`** matches the existing `dist`
  script — keeps unsigned builds explicit so the runner doesn't try and fail
  to discover a non-existent signing cert.
- **No matrix.** Single Windows job; keep it boring.
- **`fetch-depth: 0`** not required (the build doesn't read git history).
- **Caching** pnpm store across runs via `actions/setup-node`'s pnpm cache
  is a nice-to-have; add only if obvious from `pnpm-lock.yaml`'s presence.
  Default to skipping caching in the first iteration — debug a working build
  before optimizing.

### Release notes

electron-builder will create or update the Release for the tag. To get useful
release notes:

- **Option A (simplest, recommended):** the workflow does not generate notes.
  The human tagging the release uses `gh release edit v0.7.0 --notes …` (or
  edits in the GitHub UI) after the workflow uploads assets. Document this
  in CLAUDE.md §11.
- **Option B:** add a step that runs `gh release create` first with notes
  derived from commits since the previous tag (`git log --oneline
  previous..HEAD`), then `pnpm dist` uploads assets. More moving parts;
  defer unless the human-edit path proves annoying.

Pick **A** for V07.

### Removal: `scripts/write-latest-yaml.mjs`

Already removed in block 01. No CI dependency on it.

### Documentation updates

- **CLAUDE.md §11** — replace the current paragraph about `release/latest.yaml`
  with the new release procedure:

  > **Releases.** Bump `scribe/package.json` `version`, commit
  > (`chore(release): X.Y.Z`), tag (`git tag vX.Y.Z`), push (`git push &&
  > git push --tags`). The `Release` workflow builds on a Windows runner,
  > runs typecheck/lint/test, and publishes the installer + `latest.yml` +
  > blockmap to the GitHub Release for the tag. After the workflow finishes,
  > edit the Release's notes on GitHub.

- **README** — add a short "Updating" section: "Nexus checks for updates
  every few hours and downloads them in the background. When one's ready,
  a banner offers to restart and install. You can also check manually from
  Settings → Updates." No mention of internal release plumbing.

### Verification of the workflow itself

CI workflows are notoriously hard to verify without running them. Plan for
this in implementation:

1. **Dry-run on a fork or branch.** Open a draft PR with the workflow on a
   branch; trigger via a temporary `workflow_dispatch:` input. Once it
   builds + uploads to a *test* release, remove the dispatch trigger and
   merge.
2. **First real tag** (`v0.7.0` per V07 versioning) is the true verification.
   Watch the run live; if it fails halfway, fix forward (do not delete and
   re-push the tag — that confuses the updater clients).

## Verification

### Pre-merge

- The workflow file passes `actionlint` if available; otherwise eye-check
  against the GitHub Actions schema.
- All shell snippets work on a Windows runner (PowerShell syntax — backtick
  for line-continuation, `$null` not `/dev/null`, per the shell env memory).

### First tagged release

- `git tag v0.7.0 && git push --tags` triggers the workflow.
- The workflow's run page shows `pnpm typecheck/lint/test/dist` all green.
- The corresponding GitHub Release contains exactly three assets:
  `Nexus Setup 0.7.0.exe`, `Nexus Setup 0.7.0.exe.blockmap`, `latest.yml`.
  Filename and version match the tag.
- A 0.6.x install (with block 01+02 wired) discovers the new release within
  ~60 s and goes through the full check → download → banner → install flow.

## §1 invariants — affirmation checklist

- **§1.1 No audio.** Unaffected.
- **§1.2 API keys.** The workflow uses `GITHUB_TOKEN` (auto-provided by
  Actions) — no app-level API key crosses the boundary. The client never
  receives the token; it's a CI-only secret used by electron-builder to upload
  assets.
- **§1.3 / §1.5 / §1.6 / §1.7.** Unaffected — CI plumbing only.

## Deferred (named future work)

- **Code-signing the installer.** Procure an OV or EV Authenticode certificate;
  add as a CI secret; pass via `CSC_LINK` / `CSC_KEY_PASSWORD` env vars to
  electron-builder; flip `signAndEditExecutable: true`. Removes Windows
  SmartScreen warnings for users on first install. Not blocked by anything in
  V07; ship when the cert is in hand.
- **Auto-generated release notes** (option B above) if hand-editing becomes a
  drag.
- **Linux / macOS builds.** Out of scope while the product is Windows-only.

## Acceptance

- `.github/workflows/release.yml` lands and runs cleanly on a test tag (or on
  the first real `v0.7.0`).
- A tagged release produces installer + `latest.yml` + `.blockmap` as Release
  assets, all named correctly.
- CLAUDE.md §11 + README updated to reflect the new procedure.
- One commit, directly to `main`, Conventional Commits
  (`ci(release): publish to GitHub Releases on tag push`).
