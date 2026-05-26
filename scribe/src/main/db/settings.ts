import { SetLanguageSchema } from '../../shared/ipc-contract';
import type { LanguageSetting } from '../../shared/types';
import { getDb } from './index';

// Key-value settings store + the "wipe all data" action (PRODUCT_SPEC.md §10).
// API keys are stored here as encrypted blobs by secrets/api-keys; non-secret
// settings (device, language, privacy flag) are stored in plaintext.

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value);
}

export function deleteSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}

/**
 * Returns the persisted language setting as a structured LanguageSetting.
 * Handles backward-compat: old installs stored a plain string ('en', 'auto').
 */
export function getLanguage(): LanguageSetting {
  const raw = getSetting('language');
  if (!raw) return { mode: 'fixed', bcp47: 'en' };
  try {
    return SetLanguageSchema.parse(JSON.parse(raw));
  } catch {
    // Legacy plain-string values stored before this migration.
    if (raw === 'auto') return { mode: 'auto' };
    return { mode: 'fixed', bcp47: raw };
  }
}

// Leaves nothing behind (PRODUCT_SPEC.md §7): meetings + children + FTS + every
// setting, including the encrypted API keys.
export function wipeAllData(): void {
  const db = getDb();
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM transcript_segments').run();
    db.prepare('DELETE FROM notes').run();
    db.prepare('DELETE FROM meetings').run();
    db.prepare('DELETE FROM search_fts').run();
    db.prepare('DELETE FROM settings').run();
  });
  wipe();
}
