# ROADMAP_01 — Production Calendar OAuth Setup (Google + Microsoft)

## Problem

Calendar Connect (Google + Outlook) is broken in the production (NSIS-
installed) Nexus app. The OAuth flow itself was shipped in V03 ROADMAP_06 and
works in dev because `scribe/.env` is present in `process.cwd()`. In a packaged
build, that file isn't there — so `scribe/src/main/calendar/config.ts:17–31`
(`ensureEnvLoaded`) silently no-ops, `GOOGLE_OAUTH_CLIENT_SECRET` and
`MICROSOFT_OAUTH_CLIENT_ID` stay empty, and `isGoogleConfigured()` /
`isMicrosoftConfigured()` return `false`. The user clicks Connect, sees
"Google Calendar is not configured" or "Microsoft Calendar is not configured",
and the browser never opens.

This block is a precise checklist of what to set up on the Google Cloud
Console and the Microsoft Entra portal, plus the small code/deploy change that
lets the packaged app actually read those credentials at runtime.

## Goal

After this block lands, a freshly installed packaged Nexus build (e.g. on a
clean Windows user) successfully completes Connect for both Google and
Microsoft, populates the agenda, and triggers auto-start at meeting time —
without any per-machine `.env` setup, env-var configuration, or other manual
steps for the end user.

## Non-goals

- Code-signing the installer (orthogonal — SmartScreen warnings on first run
  don't break Connect).
- Switching to a hosted Web OAuth flow (would require a server; the loopback
  PKCE flow is correct for a desktop app).
- Updating the V07 in-app updater work (different roadmap).
- Expanding scopes beyond `calendar.freebusy` / `Calendars.Read*` (V03 chose
  least-privilege deliberately — see `config.ts:46–48` and `:90–101`).
- Submitting the Google OAuth app for verification (only needed to ship beyond
  the test-user list).

## What the app expects (must match the portals exactly)

Both providers use the same shape: PKCE auth-code flow, system browser opens,
app starts a loopback HTTP server on a random port, callback path is
`/callback`. Source: `scribe/src/main/calendar/google-oauth.ts` and
`scribe/src/main/calendar/microsoft-oauth.ts`.

| | Google | Microsoft (Entra) |
|---|---|---|
| OAuth client type | **Desktop app** | **Mobile and desktop applications** (public client) |
| Redirect host (app uses) | `http://127.0.0.1:<random>/callback` | `http://localhost:<random>/callback` |
| What to register as redirect URI | *(nothing — Desktop clients allow loopback automatically)* | `http://localhost` (Entra matches loopback ignoring the port; add `http://localhost/callback` too if Entra complains) |
| Client secret | **Required** (`GOCSPX-…`) — sent in token exchange even with PKCE (Google's Desktop client mandate) | **Must NOT be created** (PKCE replaces it; sending a secret causes Entra to reject the request) |
| Scopes the app requests | `https://www.googleapis.com/auth/calendar.freebusy` | `openid profile offline_access https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.Read.Shared` |
| Tenant / account types | n/a | `common` (work + school + personal) by default; `MICROSOFT_OAUTH_TENANT` overrides to `organizations` or a tenant GUID |

## Part 1 — Google Cloud Console setup

Do this once per environment (e.g. once for testing, again for prod if you
want to separate them).

1. **Open** <https://console.cloud.google.com> and create or select a project
   (e.g. "Nexus").
2. **APIs & Services → Library** → search "Google Calendar API" → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - **App name**: "Nexus" (this is what users see in the consent screen).
   - **User support email**: your address.
   - **Developer contact**: your address.
   - **Scopes** → **Add or remove scopes** → manually add
     `https://www.googleapis.com/auth/calendar.freebusy` (the only one the app
     uses; least-privilege, no event titles or attendees).
   - **Test users** → add every Google account you'll sign in with while the
     app is in "Testing" mode. Unverified apps in Testing can only be used by
     listed test users.
   - Leave publishing status as **Testing**. Switching to **In production**
     requires Google verification because `calendar.freebusy` is a "sensitive"
     scope — only needed when shipping beyond the test-user list. Not blocking
     for personal/dev use.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - **Application type**: **Desktop app** (critical — choosing "Web
     application" makes the loopback flow fail with `redirect_uri_mismatch`
     because Web clients require pre-registered exact URIs and Nexus uses a
     random loopback port each time).
   - **Name**: "Nexus Desktop" (cosmetic).
   - Click **Create**.
   - Dialog shows **Client ID** and **Client secret** (`GOCSPX-…`). **Copy
     both** and click **Download JSON** as a backup.
   - **Do not configure any redirect URIs** in this dialog — Desktop clients
     auto-allow loopback (`http://127.0.0.1:<port>`), which is what the app
     uses.
5. **Quotas** — default Calendar API quota is far more than this app needs;
   no action required.

### Two things to double-check on Google

- The OAuth client is the **Desktop app** type (step 4). If a "Web application"
  client was previously created and the app is using its ID, every Connect
  attempt fails with `redirect_uri_mismatch`.
- The **client secret** is `GOCSPX-…` format. Google labels it as
  non-confidential for installed apps (which is why the client ID is also safe
  to ship publicly), but the token endpoint **requires** it in the request
  body. Without it, Google returns `invalid_client`.

## Part 2 — Microsoft Entra setup (Azure portal)

1. **Open** <https://portal.azure.com> → **Microsoft Entra ID** (formerly
   Azure Active Directory) → **App registrations** → **New registration**.
2. **Name**: "Nexus".
3. **Supported account types**: **"Accounts in any organizational directory
   (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft
   accounts (e.g. Skype, Xbox)"**. This matches the app's default tenant
   `common`. Pick a narrower option only if you also set
   `MICROSOFT_OAUTH_TENANT` to `organizations` (work/school only) or a tenant
   GUID (single tenant).
4. **Redirect URI**:
   - Platform: **Mobile and desktop applications** (not "Web" — that's a
     different flow and will fail with `AADSTS9002326` / "Cross-origin token
     redemption is permitted only for the 'Single-Page Application'
     client-type").
   - Value: `http://localhost`. Entra matches loopback by hostname + path and
     ignores the port (per Microsoft's docs).
   - Click **Register**.
5. From the new app's **Overview** page, copy the **Application (client) ID**
   (a GUID).
6. **Authentication** (left nav):
   - Confirm the redirect URI `http://localhost` is listed under "Mobile and
     desktop applications". If sign-in ever reports a redirect mismatch, **add
     a second entry** `http://localhost/callback` (the app serves the auth
     code on `/callback`).
   - Under **Advanced settings → Allow public client flows**, set to **Yes**.
     Required for the loopback PKCE flow; many tenants default to No.
   - **Do NOT** add an "Implicit grant" tokens checkbox.
7. **Certificates & secrets**: **do not create a client secret**. Public
   clients reject token requests carrying a secret. If one was created
   earlier, leave it — `microsoft-oauth.ts:113–119` deliberately omits the
   secret from the token request, so an unused secret on the registration
   doesn't hurt.
8. **API permissions** (optional but recommended for clarity — the app also
   works with dynamic consent if you skip this):
   - **Add a permission → Microsoft Graph → Delegated permissions**, search
     and tick:
     - `Calendars.Read`
     - `Calendars.Read.Shared`
     - `offline_access`
   - **Add permissions**. **No "Grant admin consent" needed** — all three are
     user-consentable.
9. **Token configuration** — no action; the app reads `preferred_username` /
   `email` from the id_token automatically
   (`microsoft-oauth.ts:56–69`, `microsoft-provider.ts:167–169`).

### Two things to double-check on Microsoft

- **Mobile and desktop applications** platform — not "Web", not "Single-page
  application". Wrong platform is the most common Entra-side cause of failure.
- **No client secret is sent.** If a secret was created earlier on the
  registration it's fine; the app omits it from token requests by design.

## Part 3 — Get the credentials into the packaged app

This is the production-deployment step that today is the blocker. Pick **one**.

### Option A (recommended): bundle the values into `config.ts`

Single-file edit in `scribe/src/main/calendar/config.ts`:

- `BUNDLED_GOOGLE_CLIENT_ID` (`:34`) — replace with the prod client ID if
  different from the placeholder.
- `BUNDLED_GOOGLE_CLIENT_SECRET` (`:40`) — paste the `GOCSPX-…` secret. Google
  labels Desktop client secrets non-confidential for installed apps; this is
  the same posture Slack/Discord/VS Code ship.
- `BUNDLED_MICROSOFT_CLIENT_ID` (`:76`) — paste the Entra **Application
  (client) ID** (a GUID).

Commit (note in the message that the Google Desktop client secret is
intentionally bundled per Google's installed-app policy). The next `pnpm dist`
produces a packaged build with credentials baked in — zero environment
dependencies for end users. Dev `.env` overrides keep working: the resolution
order in `getGoogleClientId()` / `getGoogleClientSecret()` / `getMicrosoftClientId()`
prefers the env var when present (`config.ts:53–61`, `:104–106`).

### Option B: ship `.env` as an extra resource and load it from the right path

Two edits:

1. `scribe/electron-builder.yml` — add an `extraResources` entry copying
   `scribe/.env` into the packaged app's `resources/` directory.
2. `scribe/src/main/calendar/config.ts` — change the `ensureEnvLoaded` lookup
   (`:21`) to try `process.resourcesPath/.env` first when `app.isPackaged`,
   then fall back to `process.cwd()/.env` for dev.

More moving parts; harder to keep secrets out of the installer if it's ever
distributed broadly. Reasonable only if credentials must rotate per install
without rebuilding.

## Part 4 — Doc reconciliation

`scribe/docs/CALENDAR_SETUP.md` already documents the portal-side flow for both
providers. It's missing exactly two things:

1. The production credential-delivery step (Part 3 above).
2. The error-code → portal-setting troubleshooting table (Verification section
   below).

Fold both into CALENDAR_SETUP.md as part of this block so there's one source
of truth.

## Verification

After both portal setup (Parts 1+2) AND credential delivery (Part 3):

1. Reinstall the packaged app on a clean Windows user (or your normal machine
   after wiping `scribe/.env` to simulate end-user conditions).
2. Open the app → Settings → Calendar.
3. Click **Connect with Google**:
   - The default browser opens to the Google consent screen.
   - First time, "Google hasn't verified this app" appears because the
     consent screen is in Testing. Click **Advanced → Go to Nexus (unsafe)** —
     only listed test users can reach this. Approve.
   - Back in Nexus, the Calendar section shows the Google account as
     **Connected** within a few seconds.
4. Click **Connect with Microsoft**:
   - Browser opens to `login.microsoftonline.com`. Sign in with an account
     matching the tenant chosen in Part 2 step 3.
   - Entra may show a consent prompt listing "Read user and shared calendars"
     + "Maintain access to data". Approve.
   - Back in Nexus, Calendar section shows the connected mailbox.
5. Open a calendar event within the next ~15 minutes and confirm the
   auto-start hook fires (per V03 ROADMAP_06 acceptance).

### If a step fails, the specific error tells you what's wrong

| Error / behavior | Where to look |
|---|---|
| Settings shows "Google Calendar is not configured" before the browser opens | `GOOGLE_OAUTH_CLIENT_SECRET` not reaching the packaged app — apply Part 3. |
| Google returns `invalid_client` after consent | Client secret missing or wrong, or a "Web application" was registered instead of "Desktop app". |
| Google returns `redirect_uri_mismatch` | A "Web application" client was registered (which requires an exact URI). Recreate as **Desktop app**. |
| Google "Access blocked: Nexus has not completed verification" with no Advanced link | The signed-in Google account is not in the **Test users** list on the consent screen. Add it. |
| Settings shows "Microsoft Calendar is not configured" | `MICROSOFT_OAUTH_CLIENT_ID` not reaching the packaged app — apply Part 3. |
| Entra returns `AADSTS9002326` ("Cross-origin token redemption…") | Wrong platform — recreate redirect URI under **Mobile and desktop applications**. |
| Entra returns `AADSTS7000218` ("…request body must contain… 'client_assertion' or 'client_secret'") | "Allow public client flows" is **No** on the registration. Flip to **Yes** under Authentication → Advanced settings. |
| Entra returns `AADSTS50011` ("…redirect URI specified in the request does not match…") | Add `http://localhost/callback` as a second redirect URI under Mobile and desktop applications. |
| Entra returns `AADSTS650052` / `AADSTS50194` (org doesn't allow personal/external accounts) | Tenant mismatch — change the registration's "Supported account types" or set `MICROSOFT_OAUTH_TENANT` to match (`organizations` for work-only, or a tenant GUID). |
| Connect succeeds but the agenda shows no events | Token is fine; the Graph call returns no items. Check the account actually has events; for personal accounts the code falls back from `getSchedule` to `calendarView` automatically (`microsoft-provider.ts:65–74`). |

### Type/lint/test/build gates

If Option A only: `corepack pnpm typecheck && corepack pnpm lint &&
corepack pnpm test && corepack pnpm build` all clean before commit. (The change
is constant-only; no behavior change to test beyond the manual verification
above.)

If Option B: same gates, plus verify the `.env` file actually lands in the
installer's `resources/` folder (`pnpm dist`, then unzip the produced
`.exe` / inspect the asar to confirm).

## §1 invariants — affirmation checklist for the commit

- **§1.1 No audio touched.** Unaffected.
- **§1.2 API keys never in the renderer / never logged.** The Microsoft client
  ID is a public PKCE-only identifier. The Google Desktop client secret is
  Google-labelled non-confidential for installed apps; bundling it matches
  Slack/Discord/VS Code posture. Both values live in main only (already
  enforced by `getGoogleClientSecret()` / `getMicrosoftClientId()` being
  main-process exports); neither is exposed via the preload bridge or
  IPC-returned anywhere. The logger already redacts secrets (no change
  required).
- **§1.3 Renderer untrusted.** Unaffected — no new IPC channels, no schema
  changes; the renderer continues to call the existing `window.api.calendar.
  connect(providerId)`.
- **§1.4 No bot integration.** Unaffected.
- **§1.5 User notes are sacred.** Unaffected — no DB writes added.
- **§1.6 / §1.7.** Unaffected.

State each invariant explicitly in the commit message per CLAUDE.md §10.

## Acceptance

- Both Google and Microsoft OAuth apps are registered per Parts 1+2.
- `scribe/src/main/calendar/config.ts` ships the three bundled values (Option
  A) — OR `scribe/electron-builder.yml` + `config.ts` ship `.env` via
  `extraResources` (Option B).
- `scribe/docs/CALENDAR_SETUP.md` is updated with the Part 3 credential-
  delivery step and the troubleshooting table from Verification.
- A fresh packaged install (no `.env` on the machine) completes both Connect
  flows end-to-end per Verification step 3 and 4.
- One commit, directly to `main`, Conventional Commits (e.g.
  `fix(calendar): ship OAuth credentials in packaged build`).
