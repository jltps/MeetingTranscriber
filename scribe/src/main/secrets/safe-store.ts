import { safeStorage } from 'electron';

// Wraps Electron safeStorage (Windows DPAPI) for API-key encryption at rest
// (CLAUDE.md §1.2, PRODUCT_SPEC.md §7). Encrypted blobs are stored base64-encoded
// in the settings table; plaintext keys never touch disk.
export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable; cannot store the API key safely.');
  }
  return safeStorage.encryptString(plain).toString('base64');
}

export function decryptSecret(base64: string): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(base64, 'base64'));
  } catch {
    return null;
  }
}
