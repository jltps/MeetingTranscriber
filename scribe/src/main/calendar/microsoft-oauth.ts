import {
  MICROSOFT_OAUTH,
  getMicrosoftClientId,
  getMicrosoftTenant,
  isMicrosoftConfigured,
} from './config';
import { challengeFromVerifier, generateVerifier, randomState } from './pkce';
import { captureLoopbackCode } from './oauth-loopback';
import {
  clearMicrosoftTokens,
  getMicrosoftAccessToken,
  getMicrosoftRefreshToken,
  getMicrosoftTokenExpiry,
  isMicrosoftConnected,
  setMicrosoftUserEmail,
  storeMicrosoftTokens,
} from '../secrets/calendar-tokens';
import { logger } from '../logger';

// Microsoft / Entra OAuth 2.0 + PKCE "public client" flow, entirely in the main
// process (CLAUDE.md §1.2/§1.3). Login opens in the SYSTEM browser; a loopback
// HTTP server (shared oauth-loopback.ts) catches the redirect. Unlike Google,
// an Entra public client uses NO client secret. Tokens are stored encrypted and
// NEVER logged. We also pull the signed-in mailbox address from the id_token —
// the Graph getSchedule call needs it.

const EXPIRY_SAFETY_MS = 60 * 1000; // refresh 60s before the real expiry

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

/** Build a diagnosable error string from Entra's token-endpoint error body. */
function describeTokenError(json: TokenResponse, status: number): string {
  if (json.error) {
    return json.error_description ? `${json.error}: ${json.error_description}` : json.error;
  }
  return `HTTP ${status}`;
}

function tokenEndpoint(): string {
  return MICROSOFT_OAUTH.tokenEndpoint.replace('{tenant}', getMicrosoftTenant());
}

/**
 * Read the user's mailbox address from the id_token without verifying its
 * signature: it arrived over TLS straight from Entra's token endpoint and is
 * used only locally to query the user's own free/busy. `preferred_username` is
 * the UPN/email for work accounts; `email` is the fallback for personal ones.
 */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      preferred_username?: string;
      email?: string;
    };
    return claims.preferred_username ?? claims.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Run the full connect flow: open consent, catch the loopback redirect, exchange
 * the code for tokens, and store them (plus the mailbox address). Resolves on
 * success; rejects on denial, timeout, or token-exchange failure.
 */
export async function runMicrosoftOAuth(): Promise<void> {
  if (!isMicrosoftConfigured()) {
    throw new Error(
      'Microsoft Calendar is not configured. Register an Entra "Mobile & desktop" app ' +
        'and set MICROSOFT_OAUTH_CLIENT_ID in scribe/.env. See docs/CALENDAR_SETUP.md.',
    );
  }
  const verifier = generateVerifier();
  const challenge = challengeFromVerifier(verifier);
  const state = randomState();

  const { code, redirectUri } = await captureLoopbackCode({
    state,
    host: 'localhost', // Entra registers/accepts http://localhost loopback
    buildAuthUrl: (redirect) => {
      const authUrl = new URL(MICROSOFT_OAUTH.authEndpoint.replace('{tenant}', getMicrosoftTenant()));
      authUrl.searchParams.set('client_id', getMicrosoftClientId());
      authUrl.searchParams.set('redirect_uri', redirect);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('response_mode', 'query');
      authUrl.searchParams.set('scope', MICROSOFT_OAUTH.scope);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);
      return authUrl.toString();
    },
  });

  await exchangeCodeForTokens(code, verifier, redirectUri);
  logger.info('Microsoft Calendar connected');
}

async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<void> {
  const body = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: MICROSOFT_OAUTH.scope,
  });
  const res = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(`Token exchange failed: ${describeTokenError(json, res.status)}`);
  }
  storeMicrosoftTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiryMs: Date.now() + (json.expires_in ?? 3600) * 1000 - EXPIRY_SAFETY_MS,
  });
  const email = emailFromIdToken(json.id_token);
  if (email) setMicrosoftUserEmail(email);
}

/**
 * Return a non-expired access token, refreshing via the stored refresh token
 * when needed. Throws if not connected. Entra rotates the refresh token on every
 * refresh, so we always persist the new one. On invalid_grant the stored tokens
 * are cleared so the UI prompts re-connect.
 */
export async function getValidMicrosoftAccessToken(): Promise<string> {
  if (!isMicrosoftConnected()) throw new Error('Microsoft Calendar is not connected.');
  const access = getMicrosoftAccessToken();
  if (access && Date.now() < getMicrosoftTokenExpiry()) return access;

  const refreshToken = getMicrosoftRefreshToken();
  if (!refreshToken) throw new Error('Microsoft Calendar is not connected.');

  const body = new URLSearchParams({
    client_id: getMicrosoftClientId(),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: MICROSOFT_OAUTH.scope,
  });
  const res = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant') {
      clearMicrosoftTokens();
      throw new Error('Microsoft Calendar session expired — please reconnect.');
    }
    throw new Error(`Token refresh failed: ${describeTokenError(json, res.status)}`);
  }
  storeMicrosoftTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token, // Entra rotates it — persist the new one
    expiryMs: Date.now() + (json.expires_in ?? 3600) * 1000 - EXPIRY_SAFETY_MS,
  });
  return json.access_token;
}

/**
 * Disconnect. Entra has no simple token-revocation endpoint for public clients
 * (revocation is an admin/Graph operation), so we forget the tokens locally —
 * that severs this app's access from the user's perspective.
 */
export function revokeMicrosoft(): Promise<void> {
  clearMicrosoftTokens();
  return Promise.resolve();
}
