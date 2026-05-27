import { deleteSetting, getSetting, setSetting } from '../db/settings';
import { decryptSecret, encryptSecret } from './safe-store';

// OAuth token storage for calendar providers (ROADMAP_06). Access + refresh
// tokens are stored encrypted via safeStorage exactly like the API keys
// (CLAUDE.md §1.2) — never plaintext, never returned to the renderer, never
// logged. The expiry is a plain epoch-ms number (not a secret). Pattern mirrors
// secrets/api-keys.ts.

const GOOGLE_ACCESS = 'google_cal_access_token_enc';
const GOOGLE_REFRESH = 'google_cal_refresh_token_enc';
const GOOGLE_EXPIRY = 'google_cal_token_expiry';

function readSecret(settingKey: string): string | null {
  const stored = getSetting(settingKey);
  if (!stored) return null;
  return decryptSecret(stored);
}

/**
 * Persist tokens after an OAuth exchange or refresh. The access token + expiry
 * are always updated; the refresh token is only overwritten when the provider
 * returns a new one (Google omits it on refresh) — otherwise the existing one
 * is kept so the connection survives.
 */
export function storeGoogleTokens(args: {
  accessToken: string;
  expiryMs: number;
  refreshToken?: string;
}): void {
  setSetting(GOOGLE_ACCESS, encryptSecret(args.accessToken));
  setSetting(GOOGLE_EXPIRY, String(args.expiryMs));
  if (args.refreshToken && args.refreshToken.trim()) {
    setSetting(GOOGLE_REFRESH, encryptSecret(args.refreshToken.trim()));
  }
}

export function getGoogleAccessToken(): string | null {
  return readSecret(GOOGLE_ACCESS);
}

export function getGoogleRefreshToken(): string | null {
  return readSecret(GOOGLE_REFRESH);
}

export function getGoogleTokenExpiry(): number {
  const raw = getSetting(GOOGLE_EXPIRY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Connected = we hold a refresh token we can mint access tokens from. */
export function isGoogleConnected(): boolean {
  return getGoogleRefreshToken() !== null;
}

export function clearGoogleTokens(): void {
  deleteSetting(GOOGLE_ACCESS);
  deleteSetting(GOOGLE_REFRESH);
  deleteSetting(GOOGLE_EXPIRY);
}

// ─── Microsoft / Entra (ROADMAP_06 Phase 2) ─────────────────────────────────
// Same storage rules as Google. Microsoft additionally needs the signed-in user's
// mailbox address (for the Graph getSchedule body) — that is NOT a secret, just
// app metadata, so it's stored as a plain setting. Microsoft also ROTATES the
// refresh token on every refresh and returns a new one each time; storeMicrosoft-
// Tokens overwrites it whenever present, which keeps the connection alive.
const MICROSOFT_ACCESS = 'microsoft_cal_access_token_enc';
const MICROSOFT_REFRESH = 'microsoft_cal_refresh_token_enc';
const MICROSOFT_EXPIRY = 'microsoft_cal_token_expiry';
const MICROSOFT_EMAIL = 'microsoft_cal_user_email';

export function storeMicrosoftTokens(args: {
  accessToken: string;
  expiryMs: number;
  refreshToken?: string;
}): void {
  setSetting(MICROSOFT_ACCESS, encryptSecret(args.accessToken));
  setSetting(MICROSOFT_EXPIRY, String(args.expiryMs));
  if (args.refreshToken && args.refreshToken.trim()) {
    setSetting(MICROSOFT_REFRESH, encryptSecret(args.refreshToken.trim()));
  }
}

export function getMicrosoftAccessToken(): string | null {
  return readSecret(MICROSOFT_ACCESS);
}

export function getMicrosoftRefreshToken(): string | null {
  return readSecret(MICROSOFT_REFRESH);
}

export function getMicrosoftTokenExpiry(): number {
  const raw = getSetting(MICROSOFT_EXPIRY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** The signed-in mailbox address (e.g. user@contoso.com). Not a secret. */
export function setMicrosoftUserEmail(email: string): void {
  setSetting(MICROSOFT_EMAIL, email);
}

export function getMicrosoftUserEmail(): string | null {
  return getSetting(MICROSOFT_EMAIL);
}

export function isMicrosoftConnected(): boolean {
  return getMicrosoftRefreshToken() !== null;
}

export function clearMicrosoftTokens(): void {
  deleteSetting(MICROSOFT_ACCESS);
  deleteSetting(MICROSOFT_REFRESH);
  deleteSetting(MICROSOFT_EXPIRY);
  deleteSetting(MICROSOFT_EMAIL);
}
