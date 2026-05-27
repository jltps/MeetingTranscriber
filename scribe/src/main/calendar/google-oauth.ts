import http from 'node:http';
import { shell } from 'electron';
import { GOOGLE_OAUTH, getGoogleClientId, getGoogleClientSecret, isGoogleConfigured } from './config';
import { challengeFromVerifier, generateVerifier, randomState } from './pkce';
import {
  clearGoogleTokens,
  getGoogleAccessToken,
  getGoogleRefreshToken,
  getGoogleTokenExpiry,
  isGoogleConnected,
  storeGoogleTokens,
} from '../secrets/calendar-tokens';
import { logger } from '../logger';

// Google OAuth 2.0 + PKCE "installed app" flow, entirely in the main process
// (CLAUDE.md §1.2/§1.3). Login opens in the SYSTEM browser via shell.openExternal;
// a temporary loopback HTTP server catches the redirect. Google's Desktop client
// type requires the client_secret in the token/refresh requests (alongside PKCE) —
// it is supplied via env, never committed. Tokens are stored encrypted and NEVER
// logged.

const FLOW_TIMEOUT_MS = 3 * 60 * 1000; // user has 3 min to complete consent
const EXPIRY_SAFETY_MS = 60 * 1000; // refresh 60s before the real expiry

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

/** Build a diagnosable error string from Google's token-endpoint error body. */
function describeTokenError(json: TokenResponse, status: number): string {
  if (json.error) {
    return json.error_description ? `${json.error}: ${json.error_description}` : json.error;
  }
  return `HTTP ${status}`;
}

const CALLBACK_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Nexus</title></head>' +
  '<body style="font-family:sans-serif;background:#0b0e12;color:#e5e5e5;display:flex;' +
  'align-items:center;justify-content:center;height:100vh;margin:0">' +
  '<div style="text-align:center"><h2>Nexus is connected.</h2>' +
  '<p>You can close this tab and return to the app.</p></div></body></html>';

/**
 * Run the full connect flow: open consent in the browser, catch the loopback
 * redirect, exchange the code for tokens, and store them. Resolves on success;
 * rejects on denial, timeout, or token-exchange failure.
 */
export async function runGoogleOAuth(): Promise<void> {
  if (!isGoogleConfigured()) {
    throw new Error(
      'Google Calendar is not configured. A Desktop OAuth client needs BOTH a client ID ' +
        'and a client secret: set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in ' +
        'scribe/.env. See docs/CALENDAR_SETUP.md.',
    );
  }
  const verifier = generateVerifier();
  const challenge = challengeFromVerifier(verifier);
  const state = randomState();

  const { code, redirectUri } = await captureAuthCode(challenge, state);
  await exchangeCodeForTokens(code, verifier, redirectUri);
  logger.info('Google Calendar connected');
}

/** Start the loopback server, open the browser, and resolve with the auth code. */
function captureAuthCode(
  challenge: string,
  state: string,
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      // Only handle the callback path; ignore favicon etc.
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(CALLBACK_HTML);
      finish(() => {
        if (error) throw new Error(`Authorization denied: ${error}`);
        if (returnedState !== state) throw new Error('OAuth state mismatch — aborting.');
        if (!code) throw new Error('No authorization code returned.');
        return { code, redirectUri };
      });
    });

    let redirectUri = '';
    const timer = setTimeout(() => {
      finish(() => {
        throw new Error('Timed out waiting for Google authorization.');
      });
    }, FLOW_TIMEOUT_MS);

    function finish(produce: () => { code: string; redirectUri: string }): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      try {
        resolve(produce());
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }

    server.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    // Port 0 = OS picks a free port. Bind to loopback only.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        finish(() => {
          throw new Error('Failed to bind loopback server.');
        });
        return;
      }
      redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      const authUrl = new URL(GOOGLE_OAUTH.authEndpoint);
      authUrl.searchParams.set('client_id', getGoogleClientId());
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', GOOGLE_OAUTH.scope);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('access_type', 'offline'); // request a refresh token
      authUrl.searchParams.set('prompt', 'consent'); // ensure refresh token is returned
      void shell.openExternal(authUrl.toString());
    });
  });
}

async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<void> {
  const body = new URLSearchParams({
    code,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(), // required by Google's Desktop client type
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  const res = await fetch(GOOGLE_OAUTH.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(`Token exchange failed: ${describeTokenError(json, res.status)}`);
  }
  storeGoogleTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiryMs: Date.now() + (json.expires_in ?? 3600) * 1000 - EXPIRY_SAFETY_MS,
  });
}

/**
 * Return a non-expired access token, refreshing via the stored refresh token
 * when needed. Throws if not connected. On an invalid_grant (revoked/expired
 * refresh token) the stored tokens are cleared so the UI prompts re-connect.
 */
export async function getValidGoogleAccessToken(): Promise<string> {
  if (!isGoogleConnected()) throw new Error('Google Calendar is not connected.');
  const access = getGoogleAccessToken();
  if (access && Date.now() < getGoogleTokenExpiry()) return access;

  const refreshToken = getGoogleRefreshToken();
  if (!refreshToken) throw new Error('Google Calendar is not connected.');

  const body = new URLSearchParams({
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(), // required by Google's Desktop client type
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(GOOGLE_OAUTH.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant') {
      clearGoogleTokens();
      throw new Error('Google Calendar session expired — please reconnect.');
    }
    throw new Error(`Token refresh failed: ${describeTokenError(json, res.status)}`);
  }
  storeGoogleTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token, // usually absent on refresh; kept if present
    expiryMs: Date.now() + (json.expires_in ?? 3600) * 1000 - EXPIRY_SAFETY_MS,
  });
  return json.access_token;
}

/** Revoke the grant at Google and clear local tokens. Best-effort on the network. */
export async function revokeGoogle(): Promise<void> {
  const token = getGoogleRefreshToken() ?? getGoogleAccessToken();
  if (token) {
    try {
      await fetch(GOOGLE_OAUTH.revokeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
    } catch {
      /* network failure on revoke is non-fatal — we still clear locally */
    }
  }
  clearGoogleTokens();
}
