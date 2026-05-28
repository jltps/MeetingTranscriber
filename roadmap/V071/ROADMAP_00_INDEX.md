# ROADMAP_00_INDEX.md

The **V071 backlog — Production Calendar OAuth Setup (Google + Microsoft).**
V03 ROADMAP_06 shipped calendar Connect (Google + Outlook free/busy → auto-start)
and `scribe/docs/CALENDAR_SETUP.md` documented the developer setup. In live use a
gap surfaced: **calendar Connect is broken in the production (NSIS-installed)
build**, even when it works in dev. This roadmap captures the platform-side
setup checklist (what to configure on Google Cloud Console and Microsoft Entra)
and the credential-delivery fix the packaged app needs in order for the
already-shipped OAuth flow to actually find its client ID/secret at runtime.

This is small but high-leverage: until it lands, every user of a packaged Nexus
build sees "Google Calendar is not configured" / "Microsoft Calendar is not
configured" the moment they click Connect, regardless of portal setup.

> **Hold the §1 invariants exactly.** §1.2: the Microsoft client ID is public
> (PKCE-only, no secret); the Google **Desktop** client secret is labelled
> non-confidential by Google for installed apps and may be bundled — but neither
> ever reaches the renderer (resolved in main via `getGoogleClientSecret()` /
> `getMicrosoftClientId()`). §1.3: every existing IPC channel is unchanged.
> Other §1 rules are not touched.

## The block

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | Production Calendar OAuth Setup | Platform-side step-by-step for Google Cloud Console + Microsoft Entra, plus the credential-delivery fix the packaged app needs (bundle the values into `scribe/src/main/calendar/config.ts`, or ship `.env` via `extraResources`) | Setup + small main-process patch |

## Dependencies

```
V03 ROADMAP_06 (shipped) ── calendar Connect + free/busy + auto-start
   └─► V071 01 ── make the same flow work end-to-end in packaged builds
```

## Suggested order

1. **01 Production Calendar OAuth Setup** — the only block.

## Cross-cutting notes

- **Root cause.** `scribe/src/main/calendar/config.ts:17–31` (`ensureEnvLoaded`)
  reads `.env` from `process.cwd()/.env`. In a packaged NSIS install that path
  is the install directory or wherever Windows launched the app from — **not**
  the dev repo. `.env` is gitignored and not bundled, so
  `GOOGLE_OAUTH_CLIENT_SECRET` and `MICROSOFT_OAUTH_CLIENT_ID` are both empty
  in production → `isGoogleConfigured()` / `isMicrosoftConfigured()` return
  `false` → Connect short-circuits before opening a browser.
- **Recommended fix.** Bundle the three values (`BUNDLED_GOOGLE_CLIENT_ID`,
  `BUNDLED_GOOGLE_CLIENT_SECRET`, `BUNDLED_MICROSOFT_CLIENT_ID`) directly into
  `config.ts`. Same posture as Slack / Discord / VS Code installed apps and
  consistent with Google's "Desktop client secret is non-confidential" stance.
  Dev `.env` overrides keep working via existing env-var resolution.
- **Alternative (Option B in the block).** Ship `.env` as an
  electron-builder `extraResources` entry and change the lookup path to
  `process.resourcesPath/.env` when `app.isPackaged`. More moving parts; only
  worth it if credentials need to rotate per install without rebuilding.
- **Existing setup doc.** `scribe/docs/CALENDAR_SETUP.md` already documents the
  portal-side click-by-click for both providers. V071 supplements it with the
  production credential-delivery step (currently missing) plus an
  error-code → portal-setting troubleshooting table; folding both into
  CALENDAR_SETUP.md is part of the block.
- **Not in scope.** Code-signing the installer (orthogonal — SmartScreen
  warnings don't break Connect); switching to a Web OAuth flow (would require
  a server); V07's in-app updater (different roadmap).

## How to use this block with Claude Code

Feed the block file. It is mostly a checklist (portal clicks + one code change
in `config.ts`); no design work. Hold the §1 invariants, ship as one commit to
`main` (per CLAUDE.md §10), and verify against a freshly reinstalled packaged
build per the block's Verification section before declaring done.
