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

// Public Desktop OAuth client ID (PKCE — no secret). GOOGLE_OAUTH_CLIENT_ID env
// still overrides this for local dev. Project: covid19-tracker-296716.
const BUNDLED_GOOGLE_CLIENT_ID = '941880454523-ebbgatke8sq7ia0dm80phju1kvlaj7go.apps.googleusercontent.com';

export const GOOGLE_OAUTH = {
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
  // Read-only, least-privilege: events only (narrower than calendar.readonly).
  // `email` is requested only to label the connected account in the UI.
  scope: 'https://www.googleapis.com/auth/calendar.events.readonly email',
  // Primary calendar events endpoint.
  eventsEndpoint: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
} as const;

export function getGoogleClientId(): string {
  ensureEnvLoaded();
  return process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || BUNDLED_GOOGLE_CLIENT_ID;
}

export function isGoogleConfigured(): boolean {
  return getGoogleClientId().length > 0;
}
