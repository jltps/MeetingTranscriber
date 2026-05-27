# ROADMAP_09 — Rebrand to Nexus

Give the product an identity. It currently ships as **Scribe** with the default Electron
icon, no logo, and "Scribe" hard-coded in a few places. This block renames the product
to **Nexus**, adds an app icon and an in-app logo, updates the installer and window/
title-bar identity, and refreshes user-visible copy — **without orphaning existing user
data**. Personality: calm & minimal; accent emerald/teal (defined in block 01).

## Why
A polished UI with a generic Electron icon and no name still reads as a prototype. The
rebrand is the visible payoff of the V04 phase. The hard constraint is doing it without
breaking the installed base.

## Depends on
Name / appId / icon / installer are **independent** (can land anytime). The title-bar
identity (logo + name in the bar) merges after **03**. The accent comes from **01**.

## Scope

1. **Identifiers (carefully).**
   - `electron-builder.yml`: `productName: Nexus`; **keep `appId: com.scribe.app`** and
     the userData path unchanged. NSIS `shortcutName`/installer naming → Nexus.
   - `package.json`: `description` updated (the npm `name` is cosmetic — decide whether
     to change it; nothing depends on it).
2. **Icon + logo.**
   - Create `scribe/build/` and add `build/icon.ico` (electron-builder picks it up by
     default; set `win.icon: build/icon.ico`). Optionally a `build/icon.png` source.
   - Add an in-app `renderer/assets/logo.svg` (bundled SVG → no CSP impact) for the
     title bar and onboarding.
3. **Copy + window identity.**
   - `index.html` `<title>Nexus</title>`; window title and any "Scribe" string in
     `main/index.ts`; the title-bar brand (block 03); onboarding + privacy copy; export
     filenames in `db/export.ts`.
   - Update `README.md`; flag (don't silently rewrite) the historical "Scribe"
     references in `CLAUDE.md` / `PRODUCT_SPEC.md` as a docs follow-up — ground truth is
     code, and those are historical.

## Key decisions & caveats
- **Keep `appId: com.scribe.app` and the userData path.** Changing either orphans the
  existing local DB and the `safeStorage`-encrypted keys — i.e. it would silently lose
  every user's meetings. This is the §1.5 "notes are sacred" line for the rebrand. Flag
  it loudly; the rename is purely cosmetic at the OS-identity level.
- **Keep `app: 'scribe'`** in `BackupBundleSchema` (`shared/ipc-contract.ts`) so existing
  backup files still validate on restore. Renaming the literal would break restore of
  every backup made before V04. (Optionally widen to accept both, but keeping `'scribe'`
  is the safe default.)
- **Installer/icon must not reintroduce a signing download.** The config sets
  `signAndEditExecutable: false` (the comment-era reason: no toolchain on the build
  machine). Embedding an icon may invoke rcedit; verify `pnpm dist` still builds without
  re-triggering the winCodeSign fetch (keep unsigned; keep
  `CSC_IDENTITY_AUTO_DISCOVERY=false` if used). If icon embedding forces it, document the
  tradeoff and keep the app unsigned.
- **No brand webfont by default** (keeps CSP unchanged). If a brand font is wanted later,
  self-host the woff2 in renderer assets so `font-src 'self'` still holds — never a CDN
  font.

## Touches
`electron-builder.yml` (`productName`, `win.icon`, NSIS naming; **appId unchanged**),
`package.json` (description), new `scribe/build/icon.ico` (+ optional `.png`), new
`renderer/assets/logo.svg`, `renderer/index.html` (`<title>`), `main/index.ts` (title /
strings), `renderer/app/TitleBar.tsx` (logo + name, after block 03),
`renderer/features/meetings/MeetingSidebar.tsx` (drop the literal "Scribe" header),
onboarding/privacy copy, `main/db/export.ts` (filenames), `README.md`.

## IPC to add
None. Migration: none (appId/userData unchanged → existing DB stays at the same path —
the entire point of keeping `com.scribe.app`).

## Acceptance
- Product reads "Nexus" everywhere user-visible (window title, title bar, installer,
  onboarding, export filenames).
- App and installer carry the Nexus icon; in-app logo shows in the title bar/onboarding.
- **Existing installs upgrade in place** — same `com.scribe.app`, DB and keys intact.
- **Old backups still restore** (`app: 'scribe'` preserved).
- `pnpm dist` produces an NSIS installer with no new signing/download failure.
- `pnpm typecheck/lint/test/build` green; CSP unchanged.

## Out of scope
Changing `appId`/userData, code signing / notarization, a brand webfont, a marketing
site, and macOS packaging (§12).
