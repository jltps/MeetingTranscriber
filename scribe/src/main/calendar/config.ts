import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Bundled OAuth configuration for calendar providers (ROADMAP_06).
//
// The Google client ID is a PUBLIC "installed app" / desktop client — it carries
// NO secret (PKCE replaces the secret). It is safe to ship in the binary. Before
// this feature works end-to-end the dev must register a Desktop OAuth client in
// the Google Cloud console once and supply its client ID (see docs/CALENDAR_SETUP.md
// for the click-by-click). To make it work first-run for everyone, paste the ID
// into BUNDLED_GOOGLE_CLIENT_ID below and commit (public + PKCE = safe to commit).
//
// Resolution order: GOOGLE_OAUTH_CLIENT_ID env (incl. a gitignored .env, same dev
// fallback used by secrets/api-keys.ts) → the bundled default constant.

let envLoaded = false;
function ensureEnvLoaded(): void {
  if (envLoaded) return;
  envLoaded = true;
  try {
    const text = readFileSync(join(process.cwd(), '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !(match[1] in process.env)) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* no .env file — fall back to the shell environment */
  }
}

// Public Desktop OAuth client ID. GOOGLE_OAUTH_CLIENT_ID env overrides for dev.
// Project nexus-497712, client "Nexus" (Desktop app).
const BUNDLED_GOOGLE_CLIENT_ID = '527354122786-orpth3vlbsglk71jgs5fgpvhdpa9ajjd.apps.googleusercontent.com';

// Google's Desktop client type ALSO requires a client_secret in the token/refresh
// requests, even with PKCE (it's "not confidential" per Google for installed apps,
// but it is mandatory). We do NOT commit it to the public repo: instead it is
// injected into the packaged main bundle at build time by vite's `define` in
// scribe/electron.vite.config.ts when the `GOOGLE_OAUTH_CLIENT_SECRET` env var is
// set (CI provides it from a GitHub Actions secret). Local dev keeps using
// scribe/.env (gitignored). Bundling stays empty intentionally — the resolver
// below reads `process.env.GOOGLE_OAUTH_CLIENT_SECRET`, which vite rewrites to a
// literal at build time in packaged builds.
const BUNDLED_GOOGLE_CLIENT_SECRET = '';

export const GOOGLE_OAUTH = {
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
  // Least-privilege: freebusy only — reveals *when* the user is busy, never event
  // titles/attendees/links. The agenda + auto-start use busy blocks alone.
  scope: 'https://www.googleapis.com/auth/calendar.freebusy',
  // Free/busy query endpoint (POST).
  freeBusyEndpoint: 'https://www.googleapis.com/calendar/v3/freeBusy',
} as const;

export function getGoogleClientId(): string {
  ensureEnvLoaded();
  return process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || BUNDLED_GOOGLE_CLIENT_ID;
}

export function getGoogleClientSecret(): string {
  ensureEnvLoaded();
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || BUNDLED_GOOGLE_CLIENT_SECRET;
}

// Both id AND secret are required for Google's Desktop-client token exchange, so
// Connect can fail fast with a clear message instead of at the token endpoint.
export function isGoogleConfigured(): boolean {
  return getGoogleClientId().length > 0 && getGoogleClientSecret().length > 0;
}

// ─── Microsoft / Entra (ROADMAP_06 Phase 2) ─────────────────────────────────
//
// Unlike Google, an Entra "Mobile & desktop" (public) client uses PKCE with NO
// client secret — so only a client ID is needed. Register the app once (Azure
// Portal → App registrations; see docs/CALENDAR_SETUP.md) and paste its
// Application (client) ID into BUNDLED_MICROSOFT_CLIENT_ID (public — safe to ship)
// or override with MICROSOFT_OAUTH_CLIENT_ID in .env.
// Entra app registration "Nexus desktop" (Mobile and desktop platform).
const BUNDLED_MICROSOFT_CLIENT_ID = '4e037953-515b-46c1-ad4c-9b7e53018d03';

export const MICROSOFT_OAUTH = {
  // {tenant} is substituted at call time. 'common' = work/school + personal MS
  // accounts; 'organizations' = work-only; a tenant GUID = a single directory.
  authEndpoint: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
  // Graph free/busy lookup (POST). Reveals *when* the user is busy, not event
  // details — parity with the Google freebusy choice. Work/school accounts only.
  getScheduleEndpoint: 'https://graph.microsoft.com/v1.0/me/calendar/getSchedule',
  // Personal Microsoft accounts don't support getSchedule, so we fall back to
  // calendarView with a tight $select (start/end/isAllDay/showAs) — we still never
  // request titles/attendees, so no event content reaches the app.
  calendarViewEndpoint: 'https://graph.microsoft.com/v1.0/me/calendarView',
  // We request BOTH Graph read scopes, FULLY-QUALIFIED (https://graph.microsoft.com/…)
  // so the access token is unambiguously minted for Microsoft Graph:
  //   • Calendars.Read.Shared — required by getSchedule (work/school path).
  //   • Calendars.Read        — supported by BOTH account types and what
  //     calendarView (personal path) needs. Personal accounts don't honor the
  //     .Shared scope, so without plain .Read the token is ineffective (Graph 401).
  // offline_access → a refresh token; openid/profile → an id_token carrying
  // preferred_username (the mailbox address getSchedule needs).
  scope:
    'openid profile offline_access ' +
    'https://graph.microsoft.com/Calendars.Read ' +
    'https://graph.microsoft.com/Calendars.Read.Shared',
} as const;

export function getMicrosoftClientId(): string {
  ensureEnvLoaded();
  return process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() || BUNDLED_MICROSOFT_CLIENT_ID;
}

export function getMicrosoftTenant(): string {
  ensureEnvLoaded();
  return process.env.MICROSOFT_OAUTH_TENANT?.trim() || 'common';
}

// Public Entra client needs no secret, so a client ID alone is sufficient.
export function isMicrosoftConfigured(): boolean {
  return getMicrosoftClientId().length > 0;
}
