/**
 * PKCE helper tests (ROADMAP_06). Pure node:crypto — no Electron needed.
 */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { challengeFromVerifier, generateVerifier, randomState } from '../src/main/calendar/pkce';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('generateVerifier', () => {
  it('produces a 43–128 char base64url string', () => {
    for (let i = 0; i < 20; i++) {
      const v = generateVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9\-_]+$/); // unreserved set, no padding
    }
  });

  it('is non-repeating', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateVerifier()));
    expect(set.size).toBe(100);
  });
});

describe('challengeFromVerifier', () => {
  it('equals base64url(SHA-256(verifier)) for a known vector', () => {
    // RFC 7636 Appendix B vector.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(challengeFromVerifier(verifier)).toBe(expected);
  });

  it('matches a freshly computed digest', () => {
    const v = generateVerifier();
    expect(challengeFromVerifier(v)).toBe(base64url(createHash('sha256').update(v).digest()));
  });
});

describe('randomState', () => {
  it('is non-empty and non-repeating', () => {
    const set = new Set(Array.from({ length: 100 }, () => randomState()));
    expect(set.size).toBe(100);
    expect(randomState().length).toBeGreaterThan(0);
  });
});
