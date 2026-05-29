import {
  AudioCaptureModeSchema,
  CaptureQualitySchema,
  LlmProviderSchema,
  NotesCardViewSchema,
  QualityModeSchema,
  SetLanguageSchema,
  ThemeModeSchema,
} from '../../shared/ipc-contract';
import type {
  AudioCaptureMode,
  CaptureQuality,
  LlmProvider,
  NotesCardView,
  QualityMode,
  ThemeMode,
} from '../../shared/ipc-contract';
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

// ── Cost/quality model routing (V06 block 04) ──────────────────────────────

/** Persisted cost/quality preference. Defaults to 'quality' (the stronger model). */
export function getQualityMode(): QualityMode {
  const parsed = QualityModeSchema.safeParse(getSetting('quality_mode'));
  return parsed.success ? parsed.data : 'quality';
}

export function setQualityMode(mode: QualityMode): void {
  setSetting('quality_mode', QualityModeSchema.parse(mode));
}

// ── LLM provider (V06 block 05) ─────────────────────────────────────────────

/** Active LLM backend. Defaults to 'anthropic' (the provider the app is tuned for). */
export function getLlmProvider(): LlmProvider {
  const parsed = LlmProviderSchema.safeParse(getSetting('llm_provider'));
  return parsed.success ? parsed.data : 'anthropic';
}

export function setLlmProvider(provider: LlmProvider): void {
  setSetting('llm_provider', LlmProviderSchema.parse(provider));
}

/** Base URL + model id for the OpenAI-compatible provider (empty string when unset). */
export function getOpenAiBaseUrl(): string {
  return getSetting('openai_base_url') ?? '';
}

export function setOpenAiBaseUrl(url: string): void {
  setSetting('openai_base_url', url);
}

export function getOpenAiModel(): string {
  return getSetting('openai_model') ?? '';
}

export function setOpenAiModel(model: string): void {
  setSetting('openai_model', model);
}

// ── In-app auto-update (V07) ───────────────────────────────────────────────

/**
 * Whether the updater performs the boot-time check and the periodic timer.
 * Defaults to true. The "Check now" button in Settings always works regardless.
 */
export function getAutoUpdateEnabled(): boolean {
  // Stored as '1'/'0'. Missing or any other value → default true.
  return getSetting('auto_update_enabled') !== '0';
}

export function setAutoUpdateEnabled(v: boolean): void {
  setSetting('auto_update_enabled', v ? '1' : '0');
}

/** ISO 8601 timestamp of the last update check (success OR not-available). */
export function getUpdateLastChecked(): string | null {
  return getSetting('update_last_checked');
}

export function setUpdateLastChecked(iso: string): void {
  setSetting('update_last_checked', iso);
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

// ── Sidebar card density (V072 block 05) ───────────────────────────────────

/** Sidebar meeting-card density. Defaults to 'extended' (the historical look). */
export function getNotesCardView(): NotesCardView {
  const parsed = NotesCardViewSchema.safeParse(getSetting('notes_card_view'));
  return parsed.success ? parsed.data : 'extended';
}

export function setNotesCardView(v: NotesCardView): void {
  setSetting('notes_card_view', NotesCardViewSchema.parse(v));
}

// ── Audio capture mode (V073) ──────────────────────────────────────────────

/**
 * How aggressively the "Me" heuristic should resist mic↔system bleed. 'auto'
 * tracks cross-correlation and raises the dominance threshold when bleed is
 * detected (the right default). 'headphones' assumes no bleed; 'speakers'
 * assumes constant bleed.
 */
export function getAudioCaptureMode(): AudioCaptureMode {
  const parsed = AudioCaptureModeSchema.safeParse(getSetting('audio_capture_mode'));
  return parsed.success ? parsed.data : 'auto';
}

export function setAudioCaptureMode(m: AudioCaptureMode): void {
  setSetting('audio_capture_mode', AudioCaptureModeSchema.parse(m));
}

// ── Filler-words capture (V075 ROADMAP_03) ─────────────────────────────────

/**
 * V075 ROADMAP_03 — whether the transcript preserves the seven canonical
 * fillers Deepgram otherwise strips. Defaults to true (Deepgram's default
 * stripping is reversed under V075). Persisted as '1' / '0' in KV settings.
 */
export function getTranscriptIncludeFillers(): boolean {
  const raw = getSetting('transcript_include_fillers');
  if (raw === null) return true; // default on
  return raw !== '0';
}

export function setTranscriptIncludeFillers(include: boolean): void {
  setSetting('transcript_include_fillers', include ? '1' : '0');
}

// ── Capture quality tier (V075 ROADMAP_04) ─────────────────────────────────

/**
 * V075 ROADMAP_04 — 'cost-saver' (default) uses the V05 mono pipeline;
 * 'best-quality' reinstates 2-channel capture so mic = ch0 always "Me"
 * and ch1 carries diarized remote speakers (≈2× Deepgram cost). Persisted
 * in KV settings.
 */
export function getCaptureQuality(): CaptureQuality {
  const parsed = CaptureQualitySchema.safeParse(getSetting('capture_quality'));
  return parsed.success ? parsed.data : 'cost-saver';
}

export function setCaptureQuality(q: CaptureQuality): void {
  setSetting('capture_quality', CaptureQualitySchema.parse(q));
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
