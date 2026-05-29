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
  /**
   * V075 ROADMAP_02: optional character offsets into `text` where Deepgram's
   * paragraph boundaries land within this single-speaker segment. Renderer
   * inserts a blank-line break at each offset. Present only when a long
   * single-speaker run spans multiple paragraphs; absent otherwise (so the
   * DB column stays NULL on the vast majority of rows).
   */
  paragraphBreaks?: number[];
  /**
   * V075 ROADMAP_03: optional per-word character spans for renderer-side
   * styling. Currently only carries filler-word ranges; the renderer wraps
   * each `isFiller: true` span in a muted/italic style so transcript
   * fidelity wins without filler tokens stealing visual focus. Ascending,
   * non-overlapping. Absent when the segment has no fillers.
   */
  wordSpans?: { start: number; end: number; isFiller: boolean }[];
  /**
   * V081 — which recording session produced this segment (1-based). Recording a
   * second time into a meeting appends a new session; the renderer shows a
   * "Session N" divider where this increments. Absent/1 on single-session notes.
   */
  sessionSeq?: number;
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
  /**
   * AI-derived, skimmable summary of the meeting's highest-value takeaways (V06 block 03).
   * Optional: absent on pre-V06 notes and on the plain-markdown fallback path.
   */
  keyPoints?: string[];
};

// ─── Post-call audio intelligence (V08 — Gladia) ────────────────────────────
// Diarization + Named Entity Recognition + sentiment, produced by the Gladia
// provider and surfaced after a call ends (a separate layer from notes §1.5 and
// the transcript). The shapes are provider-agnostic so a future provider could
// populate them too. NER/sentiment from Gladia carry no confidence score, so
// those fields are intentionally absent; entity char offsets are computed by
// substring-matching the entity text within the utterance text.

/** One detected entity within an utterance (V08). */
export type InsightEntity = {
  /** Gladia `entity_type`, e.g. 'person' | 'organization' | 'location' | 'date'. */
  kind: string;
  text: string;
  /** Character offsets into the utterance text (computed by substring match). */
  start?: number;
  end?: number;
};

/** The five sentiment classes Gladia can return (V081). */
export type SentimentLabel = 'positive' | 'negative' | 'neutral' | 'mixed' | 'unknown';

/** Per-utterance sentiment (V08; V081 widened to all 5 Gladia sentiments). */
export type InsightSentiment = {
  label: SentimentLabel;
  /** Gladia emotion label when present — one of the 25 supported emotions
   * (e.g. 'amusement', 'anger', 'positive_surprise'); free string. */
  emotion?: string;
};

/** A single enriched utterance in the post-call Insights view (V08). */
export type InsightUtterance = {
  text: string;
  /** Gladia diarization speaker id (0-indexed); -1 when diarization gave none. */
  speaker: number;
  /** Reconciled display label: 'Me' (mic-dominant) or 'Speaker N'. */
  speakerLabel: string;
  isMe: boolean;
  startMs: number;
  endMs: number;
  channel: 0 | 1;
  language?: string;
  entities: InsightEntity[];
  sentiment?: InsightSentiment;
};

/** Aggregate rollups for the Insights summary (V08; V081 widened sentiment +
 * added emotions). `sentiment`/`emotions` are utterance counts keyed by label. */
export type MeetingInsightsSummary = {
  speakers: { label: string; talkMs: number; utteranceCount: number }[];
  entityCounts: { kind: string; count: number }[];
  topEntities: { text: string; kind: string; count: number }[];
  /** Utterance counts keyed by sentiment label (positive/negative/neutral/mixed/unknown). */
  sentiment: Record<string, number>;
  /** Utterance counts keyed by emotion label. */
  emotions: Record<string, number>;
};

/**
 * Post-call intelligence for one meeting (V08). `status` mirrors the
 * `meeting_insights` job state: 'processing' while Gladia post-processes,
 * 'ready' once `utterances`/`summary` are populated, 'error' on failure.
 */
export type MeetingInsights = {
  provider: 'gladia';
  status: 'processing' | 'ready' | 'error';
  error?: string;
  utterances: InsightUtterance[];
  summary: MeetingInsightsSummary;
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
  /** Folder this meeting is filed under, or null when unfiled (ROADMAP_V04_04). */
  folderId: number | null;
  /** Last-modified timestamp for the "updated" sort; null on legacy rows (ROADMAP_V04_04). */
  updatedAt: number | null;
  /** Tag names applied to this meeting (ROADMAP_V04_04). */
  tags: string[];
};

/** Per-meeting usage snapshot (ROADMAP_01 §3). Figures are cumulative totals. */
export type MeetingUsage = {
  /** Total captured audio in milliseconds (wall-clock, single stream). */
  deepgramAudioMs: number;
  /**
   * Billed Deepgram channel count for this meeting (cost = ms × channels × rate).
   * Pre-V05 meetings are 2 (stereo capture); V05+ are 1 (mono). Defaults to 2 for
   * legacy rows via migration (V05 ROADMAP_02).
   */
  deepgramChannels: number;
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

// ─── Note organization (ROADMAP_V04_04) ────────────────────────────────────

/** A folder in the meeting hierarchy. parentId is null for top-level folders. */
export type Folder = {
  id: number;
  name: string;
  parentId: number | null;
  createdAt: number;
};

/** A flat, case-insensitive-unique label applied to meetings (many-to-many). */
export type Tag = {
  id: number;
  name: string;
  createdAt: number;
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

// ─── Cross-meeting intelligence (ROADMAP_07) ────────────────────────────────

/** One turn of a per-meeting chat conversation (history is ephemeral, §07 Phase 1). */
export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/**
 * A grounding citation in a chat answer. Phase 1 cites within one meeting, so
 * only a transcript segment id is needed.
 */
export type ChatCitation = {
  segmentId: number;
};

/**
 * Which meetings a cross-meeting query covers (ROADMAP_07 Phase 2; folder/tag
 * scopes added in ROADMAP_V04_04). 'folder' includes the folder's descendants.
 */
export type RetrievalScope =
  | { mode: 'all' }
  | { mode: 'meetings'; meetingIds: number[] }
  | { mode: 'folder'; folderId: number }
  | { mode: 'tag'; tagId: number };

/**
 * A cross-meeting citation. Segment ids are global, so each pins down both the
 * line and its source meeting — used to navigate to that meeting and flash the line.
 */
export type CrossChatCitation = {
  segmentId: number;
  meetingId: number;
  meetingTitle: string;
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
