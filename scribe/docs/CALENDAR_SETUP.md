# Google Calendar setup (ROADMAP_06)

Connecting a calendar needs a Google OAuth **client ID**. This is a Google
requirement — there's no way for any app to reach a user's private calendar
without a client registered in Google Cloud. It's a one-time, ~5-minute task.
The client ID is **public** (we use PKCE, there is no client secret), so it's
safe to commit and ship.

## 1. Create the OAuth client (once)

1. Go to <https://console.cloud.google.com> and create or pick a project.
2. **APIs & Services → Library** → search "Google Calendar API" → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type **External**, fill the app name + your email.
   - **Scopes** → add `.../auth/calendar.events.readonly` (read-only, events).
   - **Test users** → add the Google account(s) you'll sign in with.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**.
   - Copy the generated **Client ID**.

No redirect URIs to configure — Desktop clients allow loopback
(`http://127.0.0.1:<port>`) automatically, which is what the app uses.

## 2. Give the app the client ID

Either (pick one):

- **Dev / local:** copy `.env.example` to `.env` and set
  `GOOGLE_OAUTH_CLIENT_ID=<your id>`. (`.env` is gitignored.)
- **Shipping to others:** paste it into `BUNDLED_GOOGLE_CLIENT_ID` in
  `src/main/calendar/config.ts` and commit. Because it's public + PKCE, every
  build then connects with zero per-user setup.

`src/main/calendar/config.ts` reads the env var first, then the bundled
constant, so either path works with no other change.

## 3. First connect — expect the "unverified app" screen

While your OAuth consent screen is in **Testing** (the default), Google shows
"Google hasn't verified this app" on first sign-in. This is normal:

- Click **Advanced → Go to Scribe (unsafe)** to continue. Only your added test
  users can get this far, so it's safe for personal/dev use.

To remove that screen for public distribution you must submit the app for
**Google verification** (required because `calendar.events.rea5donly` is a
"sensitive" scope). That's only needed when shipping to users outside your test
list — it doesn't block development or personal use.

## Why it can't be fully automated

There is no keyless or anonymous access to a user's private calendar. The
client-registration step above is the unavoidable human part; everything after
it (the OAuth round-trip, token storage/refresh, sync, auto-start) is automatic.
