// Domain types shared across main, preload, and renderer.
// This module must import nothing from electron, node:*, or React (CLAUDE.md §3).

/**
 * Language setting for transcription + enhancement output (FEATURES §A).
 * 'auto' — use nova-3 multilingual mode; detect from transcript at LLM layer.
 * 'fixed' — pass the BCP-47 code directly to Deepgram and the enhancer.
 */
export type LanguageSetting =
  | { mode: 'auto' }
  | { mode: 'fixed'; bcp47: string };

/** A single transcribed span. channel 0 = microphone ("Me"), 1 = system audio. */
export type TranscriptSegment = {
  text: string;
  channel: 0 | 1;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
};

/** A persisted transcript segment (carries its DB id, for source linking §8.4). */
export type PersistedSegment = TranscriptSegment & { id: number };

/** Structured, source-linked enhancement returned by the LLM (PRODUCT_SPEC.md §9). */
export type EnhancedNotes = {
  blocks: Array<{
    type: 'heading' | 'paragraph' | 'bullet' | 'action_item';
    text: string;
    origin: 'user' | 'ai';
    sourceSegmentIds: number[];
  }>;
};

export type MeetingStatus = 'draft' | 'transcribing' | 'ended';

/** Row-level meeting metadata for the sidebar list (PRODUCT_SPEC.md §11). */
export type MeetingSummary = {
  id: number;
  title: string;
  status: MeetingStatus;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Template used for this meeting's enhancement, if any (FEATURES §C, Tweak 3). */
  templateId: number | null;
};

/** Per-meeting usage snapshot (ROADMAP_01 §3). Figures are cumulative totals. */
export type MeetingUsage = {
  /** Total captured audio in milliseconds (single stream; cost is 2× for Deepgram's 2-channel billing). */
  deepgramAudioMs: number;
  claudeInputTokens: number;
  claudeOutputTokens: number;
};

/** A meeting plus its notes, for the open editor. */
export type MeetingDetail = MeetingSummary & {
  rawUserMd: string;
  enhancedJson: string | null;
  /** Template used for this meeting's enhancement, if any (FEATURES §C). */
  templateId: number | null;
  /** BCP-47 of the language the last enhancement was written in (FEATURES §A2, §C). */
  enhancedLang: string | null;
  /** Usage stats for cost display (ROADMAP_01 §3). */
  usage: MeetingUsage;
};

/** How a template resolves its language (FEATURES §C1). */
export type TemplateLangMode = 'global' | 'auto' | 'fixed';

/** A named, reusable enhancement configuration (FEATURES §C). */
export type Template = {
  id: number;
  name: string;
  instructions: string;
  languageMode: TemplateLangMode;
  languageCode: string | null;
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
};

/** Input for creating a new template. */
export type TemplateCreate = {
  name: string;
  instructions: string;
  languageMode: TemplateLangMode;
  languageCode: string | null;
};

/**
 * A per-meeting speaker name mapping (ROADMAP_02).
 * rawLabel  — the original Deepgram-generated label, e.g. "Speaker 1" or "Me".
 * displayName — the user-assigned real name, e.g. "Ana".
 */
export type SpeakerName = {
  rawLabel: string;
  displayName: string;
};

// ─── Calendar integration (ROADMAP_06) ──────────────────────────────────────

/** Which calendar backend an event came from. */
export type CalendarProviderId = 'google' | 'microsoft';

/**
 * A normalized calendar event. Both providers map their raw shape onto this so
 * the agenda + auto-start logic stay provider-agnostic. Times are epoch ms (UTC)
 * to match the rest of the app and to cross IPC cleanly. `joinUrl` is metadata
 * only — the app never joins the call (CLAUDE.md §1.4).
 */
export type CalendarEvent = {
  providerId: CalendarProviderId;
  /** Provider event id; recurring instances get distinct ids (singleEvents). */
  externalId: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  attendees: { name?: string; email: string }[];
  joinUrl?: string;
};

/** A calendar event enriched with app-local state for the agenda UI. */
export type AgendaEvent = CalendarEvent & {
  /** User opted into auto-start for this event. */
  armed: boolean;
  /** The meeting created/linked when auto-start fired, if any. */
  meetingId: number | null;
};
