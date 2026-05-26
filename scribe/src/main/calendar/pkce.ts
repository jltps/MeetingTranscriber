import { createHash, randomBytes } from 'node:crypto';

// PKCE helpers for the OAuth 2.0 authorization-code flow (RFC 7636). Pure +
// dependency-free so they can be unit-tested without Electron. Used by every
// calendar provider's loopback OAuth flow.

/** base64url with no padding, per RFC 7636 §A. */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A high-entropy code verifier: 43–128 chars from the unreserved set.
 * 32 random bytes → 43 base64url chars.
 */
export function generateVerifier(): string {
  return base64url(randomBytes(32));
}

/** S256 challenge = base64url(SHA-256(verifier)). */
export function challengeFromVerifier(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** Opaque anti-CSRF state value tying the auth request to its callback. */
export function randomState(): string {
  return base64url(randomBytes(16));
}
