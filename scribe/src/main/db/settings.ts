import { SetLanguageSchema, ThemeModeSchema } from '../../shared/ipc-contract';
import type { ThemeMode } from '../../shared/ipc-contract';
import type { LanguageSetting } from '../../shared/types';
import type { WhisperModelName } from '../transcription/whisper-models';
import { WHISPER_MODEL_NAMES } from '../transcription/whisper-models';
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

/** Global custom instructions appended to every enhancement prompt (FEATURES §B). */
export function getGlobalInstructions(): string {
  return getSetting('global_instructions') ?? '';
}

// ── First-run onboarding (ROADMAP_V04_07) ───────────────────────────────────

/**
 * Whether the first-run flow is complete. Legacy-safe: installs that predate the
 * flag but already accepted privacy are treated as onboarded, so they aren't
 * re-onboarded. A "wipe" clears both keys, so a fresh start re-onboards.
 */
export function getOnboardingDone(): boolean {
  return getSetting('onboarding_done') === '1' || getSetting('privacy_accepted') === '1';
}

export function setOnboardingDone(): void {
  setSetting('onboarding_done', '1');
}

// ── Appearance / theming (ROADMAP_V04_01) ──────────────────────────────────

/** Persisted theme mode. Defaults to 'system' (follow the OS). */
export function getThemeMode(): ThemeMode {
  const parsed = ThemeModeSchema.safeParse(getSetting('theme_mode'));
  return parsed.success ? parsed.data : 'system';
}

export function setThemeMode(mode: ThemeMode): void {
  setSetting('theme_mode', ThemeModeSchema.parse(mode));
}

// ── Local Whisper settings (ROADMAP_05) ────────────────────────────────────

export type TranscriptionProvider = 'deepgram' | 'whisper';

export function getTranscriptionProvider(): TranscriptionProvider {
  const raw = getSetting('transcription_provider');
  return raw === 'whisper' ? 'whisper' : 'deepgram'; // default: deepgram
}

export function setTranscriptionProvider(p: TranscriptionProvider): void {
  setSetting('transcription_provider', p);
}

export function getWhisperModel(): WhisperModelName {
  const raw = getSetting('whisper_model');
  return (WHISPER_MODEL_NAMES.includes(raw as WhisperModelName)
    ? (raw as WhisperModelName)
    : 'base');
}

export function setWhisperModel(m: WhisperModelName): void {
  setSetting('whisper_model', m);
}

// Leaves nothing behind (PRODUCT_SPEC.md §7): meetings + children + FTS + every
// setting, including the encrypted API keys.
export function wipeAllData(): void {
  const db = getDb();
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM transcript_segments').run();
    db.prepare('DELETE FROM notes').run();
    db.prepare('DELETE FROM calendar_events').run();
    db.prepare('DELETE FROM meeting_tags').run();
    db.prepare('DELETE FROM meetings').run();
    db.prepare('DELETE FROM tags').run();
    db.prepare('DELETE FROM folders').run();
    db.prepare('DELETE FROM search_fts').run();
    // Clears every setting, including the encrypted API keys + calendar OAuth tokens.
    db.prepare('DELETE FROM settings').run();
  });
  wipe();
}
