# Google Calendar setup (ROADMAP_06)

Connecting a calendar needs a Google OAuth **Desktop client**. This is a Google
requirement — there's no way for any app to reach a user's private calendar
without a client registered in Google Cloud. It's a one-time, ~5-minute task.
The client ID is public (safe to commit/ship). Google's Desktop client type also
issues a **client secret** that must be sent in the token request (we use PKCE on
top of it); Google treats this secret as non-confidential for installed apps, but
we keep it out of git and read it from `.env` (see below).

## 1. Create the OAuth client (once)

1. Go to <https://console.cloud.google.com> and create or pick a project.
2. **APIs & Services → Library** → search "Google Calendar API" → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type **External**, fill the app name + your email.
   - **Scopes** → add `.../auth/calendar.freebusy` (busy times only — no event
     details). The app uses this to detect *when* you're in a meeting.
   - **Test users** → add the Google account(s) you'll sign in with.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**.
   - Copy the generated **Client ID** *and* **Client secret** (format `GOCSPX-…`).
     (You can also "Download JSON" to get both.)

No redirect URIs to configure — Desktop clients allow loopback
(`http://127.0.0.1:<port>`) automatically, which is what the app uses.

## 2. Give the app the credentials

The **client ID** is already bundled in `src/main/calendar/config.ts`
(`BUNDLED_GOOGLE_CLIENT_ID`); `GOOGLE_OAUTH_CLIENT_ID` env overrides it.

The **client secret** is required by Google's token exchange and is **not
committed** — set it in `.env`:

- Copy `.env.example` to `.env` (gitignored) and set
  `GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-…` (and `GOOGLE_OAUTH_CLIENT_ID=…` if you want
  to override the bundled one).

`isGoogleConfigured()` requires **both** id and secret, so Connect surfaces a clear
"not configured" message if the secret is missing rather than failing mid-flow.

## 3. First connect — expect the "unverified app" screen

While your OAuth consent screen is in **Testing** (the default), Google shows
"Google hasn't verified this app" on first sign-in. This is normal:

- Click **Advanced → Go to Scribe (unsafe)** to continue. Only your added test
  users can get this far, so it's safe for personal/dev use.

To remove that screen for public distribution you must submit the app for
**Google verification** (required because `calendar.events.rea5donly` is a
"sensitive" scope). That's only needed when shipping to users outside your test
list — it doesn't block development or personal use.

---

## Microsoft / Outlook (alternative provider)

For Microsoft 365 / Outlook (work or personal accounts) the equivalent is an
**Entra (Azure AD) app registration**. Two things make it simpler than Google:
it uses a **public client with NO client secret** (PKCE only), and the free/busy
permissions are **user-consentable — no tenant admin approval needed**.

Scribe learns only *when* you are busy, never event titles or attendees — the same
privacy posture as Google. On **work/school** accounts it uses the Graph
**getSchedule** (free/busy) action. **Personal** Microsoft accounts don't support
getSchedule, so it falls back to **calendarView** with a tight `$select`
(`start`, `end`, `isAllDay`, `showAs`) — still no titles/attendees are requested.
The app requests both `Calendars.Read` (works for personal **and** work accounts)
and `Calendars.Read.Shared` (getSchedule's requirement); see below.

### 1. Register the app (once)

1. Go to <https://portal.azure.com> → **Microsoft Entra ID → App registrations →
   New registration**.
2. **Supported account types**: choose **"Accounts in any organizational directory
   and personal Microsoft accounts"** (this is what tenant `common` expects; pick a
   narrower option if you set `MICROSOFT_OAUTH_TENANT` to `organizations` or a GUID).
3. **Redirect URI**: platform **Mobile and desktop applications**, value
   **`http://localhost`**. Entra matches loopback ignoring the port. If sign-in
   reports a redirect mismatch, also add **`http://localhost/callback`** (the app
   serves the code on `/callback`).
4. Create it, then copy the **Application (client) ID** from the Overview page. No
   client secret is needed — do **not** create one.
5. (Optional) **API permissions** → it works with dynamic consent, but you may add
   the delegated Microsoft Graph permissions **`Calendars.Read`**,
   **`Calendars.Read.Shared`**, and **`offline_access`** for clarity. All are
   user-consentable; **no "Grant admin consent" is required**.

### 2. Give the app the client ID

Copy `.env.example` to `.env` (gitignored) and set:

- `MICROSOFT_OAUTH_CLIENT_ID=…` (the Application (client) ID).
- Optionally `MICROSOFT_OAUTH_TENANT=common` (default) / `organizations` / a tenant
  GUID, matching the account types you chose above.

`isMicrosoftConfigured()` requires only the client ID, so Connect surfaces a clear
"not configured" message if it's missing.

### 3. First connect

Settings → Calendar → **Connect with Microsoft** opens the system browser. For a
single-tenant or untrusted multitenant app Entra may show a consent prompt listing
"Read user and shared calendars" and "Maintain access to data" — approve it. The app
stores tokens encrypted (via `safeStorage`) and reads your mailbox address from the
returned id_token to query free/busy.

---

## Why it can't be fully automated

There is no keyless or anonymous access to a user's private calendar. The
client-registration step above is the unavoidable human part; everything after
it (the OAuth round-trip, token storage/refresh, sync, auto-start) is automatic.
