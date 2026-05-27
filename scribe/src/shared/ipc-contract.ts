// The single source of truth for every IPC channel (CLAUDE.md §4).
// Each channel is declared once here with a Zod schema for its request payload.
// ipcMain handlers validate inbound requests against these before acting; the
// preload bridge wires window.api methods to these channel names. The one
// exception is the audio frame channel, a raw ArrayBuffer not validated per-frame.
import { z } from 'zod';
import type {
  AgendaEvent,
  CalendarEvent,
  CalendarProviderId,
  ChatMessage,
  CrossChatCitation,
  EnhancedNotes,
  Folder,
  LanguageSetting,
  MeetingDetail,
  MeetingSummary,
  PersistedSegment,
  RetrievalScope,
  SpeakerName,
  Tag,
  Template,
  TemplateCreate,
  TranscriptSegment,
} from './types';

export const IPC = {
  appGetStatus: 'app:getStatus',

  transcriptionStart: 'transcription:start',
  transcriptionStop: 'transcription:stop',
  transcriptionPushFrame: 'transcription:pushFrame', // renderer -> main, raw PCM
  transcriptionSegment: 'transcription:segment', // main -> renderer
  transcriptionStatus: 'transcription:status', // main -> renderer
  transcriptionLanguageDetected: 'transcription:languageDetected', // main -> renderer

  meetingsList: 'meetings:list',
  meetingsCreate: 'meetings:create',
  meetingsGet: 'meetings:get',
  meetingsGetTranscript: 'meetings:getTranscript',
  meetingsSaveNotes: 'meetings:saveNotes',
  meetingsUpdateTitle: 'meetings:updateTitle',
  meetingsStart: 'meetings:start',
  meetingsEnd: 'meetings:end',
  meetingsDelete: 'meetings:delete',
  meetingsSearch: 'meetings:search',
  meetingsSaveEnhanced: 'meetings:saveEnhanced',
  meetingsSetTemplate: 'meetings:setTemplate',
  meetingsSuggestTitle: 'meetings:suggestTitle',

  templatesList: 'templates:list',
  templatesCreate: 'templates:create',
  templatesGet: 'templates:get',
  templatesUpdate: 'templates:update',
  templatesDelete: 'templates:delete',
  templatesDuplicate: 'templates:duplicate',

  enhancerEnhance: 'enhancer:enhance',

  speakersGet: 'speakers:get',           // meetingId → SpeakerName[]
  speakersSet: 'speakers:set',           // { meetingId, rawLabel, displayName } → void
  speakersClear: 'speakers:clear',       // { meetingId, rawLabel } → void
  speakersReassign: 'speakers:reassign', // { meetingId, segmentId, newRawLabel } → void

  settingsGet: 'settings:get',
  settingsSetKeys: 'settings:setKeys',
  settingsSetMicDevice: 'settings:setMicDevice',
  settingsSetLanguage: 'settings:setLanguage',
  settingsSetGlobalInstructions: 'settings:setGlobalInstructions',
  settingsTest: 'settings:test',
  settingsAcceptPrivacy: 'settings:acceptPrivacy',
  settingsCompleteOnboarding: 'settings:completeOnboarding',
  settingsWipe: 'settings:wipe',

  themeGet: 'theme:get', // → ThemeView
  themeSet: 'theme:set', // ThemeMode → ThemeView

  exportMeeting: 'export:meeting', // meetingId → { success, path? }
  exportBackup:  'export:backup',  // void → { success, path?, meetingCount }
  exportRestore: 'export:restore', // void → { success, meetingCount }

  // Local Whisper transcription (ROADMAP_05)
  settingsSetTranscriptionProvider: 'settings:setTranscriptionProvider',
  settingsSetWhisperModel:          'settings:setWhisperModel',
  whisperModelsGet:             'whisper:modelsGet',             // → WhisperModelStatus[]
  whisperModelDownload:         'whisper:modelDownload',         // name → void (async)
  whisperModelCancel:           'whisper:modelCancel',           // → void
  whisperModelDelete:           'whisper:modelDelete',           // name → void
  whisperModelDownloadProgress: 'whisper:modelDownloadProgress', // push: DownloadProgress

  // Calendar integration (ROADMAP_06)
  calendarGetAgenda:   'calendar:getAgenda',    // → AgendaEvent[]
  calendarConnect:     'calendar:connect',      // providerId → void (runs OAuth)
  calendarDisconnect:  'calendar:disconnect',   // providerId → void (revoke + clear)
  calendarRefresh:     'calendar:refresh',      // → void (re-sync now)
  calendarArmEvent:    'calendar:armEvent',     // { providerId, externalId, armed } → AgendaEvent
  calendarLinkMeeting: 'calendar:linkMeeting',  // { providerId, externalId, meetingId } → void
  calendarAgenda:      'calendar:agenda',       // push: AgendaEvent[]

  // Cross-meeting intelligence — per-meeting chat (ROADMAP_07 Phase 1)
  chatAsk:   'chat:ask',   // { meetingId, messages } → ChatResult (streams while pending)
  chatToken: 'chat:token', // push: { requestId, token } — streamed answer deltas

  // Cross-meeting querying (ROADMAP_07 Phase 2)
  crossChatAsk: 'chat:askAcross', // { scope, messages } → CrossChatResult (streams via chat:token)

  // Note organization — folders + tags (ROADMAP_V04_04)
  foldersList: 'folders:list',
  foldersCreate: 'folders:create',
  foldersRename: 'folders:rename',
  foldersMove: 'folders:move',
  foldersDelete: 'folders:delete',
  tagsList: 'tags:list',
  tagsCreate: 'tags:create',
  tagsDelete: 'tags:delete',
  meetingsSetFolder: 'meetings:setFolder',
  meetingsAddTag: 'meetings:addTag',
  meetingsRemoveTag: 'meetings:removeTag',
} as const;

export const AppStatusSchema = z.object({
  platform: z.string(),
  appVersion: z.string(),
  dbSchemaVersion: z.number().int(),
});
export type AppStatus = z.infer<typeof AppStatusSchema>;

export const TranscriptionStartSchema = z.object({
  meetingId: z.number().int().positive(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
});
export type TranscriptionStart = z.infer<typeof TranscriptionStartSchema>;

export const TranscriptSegmentSchema = z.object({
  text: z.string(),
  channel: z.union([z.literal(0), z.literal(1)]),
  speakerLabel: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  isFinal: z.boolean(),
}) satisfies z.ZodType<TranscriptSegment>;

export const TranscriptionStatusSchema = z.object({
  state: z.enum(['open', 'closed', 'error', 'reconnecting']),
  message: z.string().optional(),
});
export type TranscriptionStatus = z.infer<typeof TranscriptionStatusSchema>;

export const MeetingIdSchema = z.number().int().positive();
export const SaveNotesSchema = z.object({ id: MeetingIdSchema, markdown: z.string() });
export type SaveNotesInput = z.infer<typeof SaveNotesSchema>;
export const UpdateTitleSchema = z.object({ id: MeetingIdSchema, title: z.string() });
export type UpdateTitleInput = z.infer<typeof UpdateTitleSchema>;
export const SearchQuerySchema = z.string();

export const EnhancedNotesSchema = z.object({
  blocks: z.array(
    z.object({
      type: z.enum(['heading', 'paragraph', 'bullet', 'action_item']),
      text: z.string(),
      origin: z.enum(['user', 'ai']),
      sourceSegmentIds: z.array(z.number()),
    }),
  ),
}) satisfies z.ZodType<EnhancedNotes>;

export const SaveEnhancedSchema = z.object({ id: MeetingIdSchema, notes: EnhancedNotesSchema });
export type SaveEnhancedInput = z.infer<typeof SaveEnhancedSchema>;

export type EnhanceResult = { notes: EnhancedNotes; degraded: boolean };

export const SetKeysSchema = z.object({
  deepgram: z.string().optional(),
  anthropic: z.string().optional(),
});
export type SetKeysInput = z.infer<typeof SetKeysSchema>;
export const SetMicDeviceSchema = z.string().nullable();
/** Structured language preference (FEATURES §A). Replaces the old plain-string schema. */
export const SetLanguageSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }),
  z.object({ mode: z.literal('fixed'), bcp47: z.string() }),
]) satisfies z.ZodType<LanguageSetting>;

/** Push payload when Deepgram (or the LLM layer) detects the transcript language. */
export const TranscriptionLanguageSchema = z.object({ bcp47: z.string() });
export type TranscriptionLanguage = z.infer<typeof TranscriptionLanguageSchema>;

/** Global enhancement instructions entered by the user in Settings (FEATURES §B). */
export const SetGlobalInstructionsSchema = z.string().max(4000);

export const TestProviderSchema = z.enum(['deepgram', 'anthropic']);
export type TestProvider = z.infer<typeof TestProviderSchema>;
// `key` lets the UI test the just-typed (unsaved) key; when omitted, the stored
// key is tested instead.
export const TestRequestSchema = z.object({
  provider: TestProviderSchema,
  key: z.string().optional(),
});

/** Aggregate usage across all meetings — for the Settings "Usage & Cost" section. */
export type UsageTotals = {
  deepgramAudioMs: number;
  claudeInputTokens: number;
  claudeOutputTokens: number;
  /**
   * Deepgram cost component (USD). Computed in main from each meeting's billed
   * channel count, so it stays correct across the 2-channel → 1-channel switch
   * (V05 ROADMAP_02) — the renderer can't derive it from summed ms alone.
   */
  deepgramCostUsd: number;
  estimatedCostUsd: number;
};

// ─── Appearance / theming (ROADMAP_V04_01) ──────────────────────────────────

/** User-chosen theme mode. 'system' follows the OS via nativeTheme.themeSource. */
export const ThemeModeSchema = z.enum(['system', 'light', 'dark']);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

/** Theme state for the renderer: the chosen mode + the currently effective theme. */
export type ThemeView = { mode: ThemeMode; effective: 'light' | 'dark' };

export interface ThemeApi {
  get(): Promise<ThemeView>;
  /** Persist the mode + drive nativeTheme.themeSource. Returns the resolved view. */
  set(mode: ThemeMode): Promise<ThemeView>;
}

export type SettingsView = {
  deepgramKeySet: boolean;
  anthropicKeySet: boolean;
  micDeviceId: string | null;
  language: LanguageSetting;
  /** Free-text instructions appended to every enhancement (FEATURES §B1). */
  globalInstructions: string;
  privacyAccepted: boolean;
  /** Whether the first-run onboarding flow is complete (ROADMAP_V04_07). */
  onboardingDone: boolean;
  /** Aggregate usage totals across all meetings (ROADMAP_01 §3). */
  usageTotals: UsageTotals;
  /** 'deepgram' (default) or 'whisper' (local, ROADMAP_05). */
  transcriptionProvider: 'deepgram' | 'whisper';
  /** Active Whisper model size key (ROADMAP_05). */
  whisperModel: string;
  /** Whether a Google Calendar account is connected (ROADMAP_06). Never the token. */
  googleCalendarConnected: boolean;
  /** Whether a Microsoft/Outlook calendar is connected (ROADMAP_06). Never the token. */
  microsoftCalendarConnected: boolean;
  /** Current appearance theme (ROADMAP_V04_01). */
  theme: ThemeView;
};
export type TestResult = { ok: boolean; message?: string };

export const TemplateIdSchema = z.number().int().positive();

export const TemplateCreateSchema = z.object({
  name: z.string().min(1).max(100),
  instructions: z.string().max(4000),
  languageMode: z.enum(['global', 'auto', 'fixed']),
  languageCode: z.string().nullable(),
}) satisfies z.ZodType<TemplateCreate>;

export const TemplateUpdateSchema = TemplateCreateSchema.partial();
export type TemplateUpdate = z.infer<typeof TemplateUpdateSchema>;

export const SetMeetingTemplateSchema = z.object({
  meetingId: MeetingIdSchema,
  templateId: TemplateIdSchema.nullable(),
});
export type SetMeetingTemplateInput = z.infer<typeof SetMeetingTemplateSchema>;

export interface TemplatesApi {
  list(): Promise<Template[]>;
  get(id: number): Promise<Template | null>;
  create(data: TemplateCreate): Promise<Template>;
  update(id: number, data: TemplateUpdate): Promise<Template>;
  remove(id: number): Promise<void>;
  duplicate(id: number): Promise<Template>;
}

// ─── Speaker naming (ROADMAP_02) ────────────────────────────────────────────

export const SpeakersSetSchema = z.object({
  meetingId: MeetingIdSchema,
  rawLabel: z.string().min(1),
  displayName: z.string().min(1).max(80),
});
export type SpeakersSetInput = z.infer<typeof SpeakersSetSchema>;

export const SpeakersClearSchema = z.object({
  meetingId: MeetingIdSchema,
  rawLabel: z.string().min(1),
});
export type SpeakersClearInput = z.infer<typeof SpeakersClearSchema>;

export const SpeakersReassignSchema = z.object({
  meetingId: MeetingIdSchema,
  segmentId: z.number().int().positive(),
  newRawLabel: z.string().min(1),
});
export type SpeakersReassignInput = z.infer<typeof SpeakersReassignSchema>;

/** Per-meeting speaker name management. */
export interface SpeakersApi {
  /** Return all user-assigned name mappings for a meeting. Empty array = no mappings (use raw labels). */
  get(meetingId: number): Promise<SpeakerName[]>;
  /** Create or replace a mapping from rawLabel → displayName. */
  set(meetingId: number, rawLabel: string, displayName: string): Promise<void>;
  /** Delete a mapping, reverting the label back to rawLabel. */
  clear(meetingId: number, rawLabel: string): Promise<void>;
  /** Reassign a specific persisted segment to a different speaker label. */
  reassign(meetingId: number, segmentId: number, newRawLabel: string): Promise<void>;
}

export interface MeetingsApi {
  list(): Promise<MeetingSummary[]>;
  create(): Promise<MeetingSummary>;
  get(id: number): Promise<MeetingDetail | null>;
  getTranscript(id: number): Promise<PersistedSegment[]>;
  saveNotes(id: number, markdown: string): Promise<void>;
  updateTitle(id: number, title: string): Promise<void>;
  start(id: number): Promise<MeetingSummary>;
  end(id: number): Promise<MeetingSummary>;
  remove(id: number): Promise<void>;
  search(query: string): Promise<MeetingSummary[]>;
  saveEnhanced(id: number, notes: EnhancedNotes): Promise<void>;
  setTemplate(meetingId: number, templateId: number | null): Promise<void>;
  suggestTitle(id: number): Promise<string | null>;
}

export interface SettingsApi {
  get(): Promise<SettingsView>;
  setKeys(keys: SetKeysInput): Promise<void>;
  setMicDevice(deviceId: string | null): Promise<void>;
  setLanguage(language: LanguageSetting): Promise<void>;
  setGlobalInstructions(instructions: string): Promise<void>;
  setTranscriptionProvider(provider: 'deepgram' | 'whisper'): Promise<void>;
  setWhisperModel(model: string): Promise<void>;
  test(provider: TestProvider, key?: string): Promise<TestResult>;
  acceptPrivacy(): Promise<void>;
  completeOnboarding(): Promise<void>;
  wipe(): Promise<void>;
}

// ─── Export & Backup (ROADMAP_04) ───────────────────────────────────────────

const BackupSegmentSchema = z.object({
  id: z.number().int(),
  channel: z.number().int(),
  speakerLabel: z.string(),
  text: z.string(),
  startMs: z.number().int(),
  endMs: z.number().int(),
});

const BackupSpeakerNameSchema = z.object({
  rawLabel: z.string(),
  displayName: z.string(),
});

const BackupMeetingSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  status: z.string(),
  createdAt: z.number().int(),
  startedAt: z.number().int().nullable(),
  endedAt: z.number().int().nullable(),
  templateId: z.number().int().positive().nullable(),
  rawUserMd: z.string(),
  enhancedJson: z.string().nullable(),
  enhancedAt: z.number().int().nullable(),
  enhancedLang: z.string().nullable(),
  templateName: z.string().nullable(),
  // Organization (backup v2). Default keeps v1 bundles (without these) valid.
  folderId: z.number().int().positive().nullable().default(null),
  tags: z.array(z.string()).default([]),
  usage: z.object({
    deepgramAudioMs: z.number().int(),
    claudeInputTokens: z.number().int(),
    claudeOutputTokens: z.number().int(),
    // Billed Deepgram channel count. Default 2 keeps pre-V05 bundles (captured in
    // 2-channel) costing correctly on restore.
    deepgramChannels: z.number().int().positive().default(2),
  }),
  segments: z.array(BackupSegmentSchema),
  speakerNames: z.array(BackupSpeakerNameSchema),
});

const BackupTemplateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  instructions: z.string(),
  languageMode: z.string(),
  languageCode: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const BackupFolderSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  parentId: z.number().int().positive().nullable(),
  createdAt: z.number().int(),
});

const BackupTagSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  createdAt: z.number().int(),
});

/**
 * Schema for validating a Scribe backup file before restoring (ROADMAP_04 §2).
 * Parsed from the user-selected JSON — validated before any DB writes. v2 adds
 * folders + tags (ROADMAP_V04_04); v1 bundles still validate (folders/tags default
 * to empty, per-meeting folderId/tags default via BackupMeetingSchema). `app`
 * stays the literal 'scribe' so older backups keep validating.
 */
export const BackupBundleSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  app: z.literal('scribe'),
  exportedAt: z.string(),
  meetings: z.array(BackupMeetingSchema),
  templates: z.array(BackupTemplateSchema),
  folders: z.array(BackupFolderSchema).default([]),
  tags: z.array(BackupTagSchema).default([]),
});
export type BackupBundle = z.infer<typeof BackupBundleSchema>;
export type BackupMeeting = z.infer<typeof BackupMeetingSchema>;

/** Export, backup, and restore API (ROADMAP_04 Phases 1 & 2). */
export interface ExportApi {
  /** Export one meeting to a Markdown file. Opens an OS save dialog. */
  exportMeeting(meetingId: number): Promise<{ success: boolean; path?: string }>;
  /** Export all meetings as a JSON backup bundle. Opens an OS save dialog. */
  exportBackup(): Promise<{ success: boolean; path?: string; meetingCount: number }>;
  /** Restore from a backup file. Opens an OS open dialog. Replaces all current meetings. */
  exportRestore(): Promise<{ success: boolean; meetingCount: number }>;
}

// ─── Local Whisper model management (ROADMAP_05) ─────────────────────────────

export const WhisperModelNameSchema = z.enum(['tiny', 'base', 'small', 'medium']);
export type WhisperModelName = z.infer<typeof WhisperModelNameSchema>;

/** Status of a single Whisper model (sent from main to renderer). */
export type WhisperModelStatus = {
  name: WhisperModelName;
  /** Expected download size in bytes. */
  sizeBytes: number;
  state: 'not-downloaded' | 'downloading' | 'ready';
  /** 0-100 while downloading. */
  progress?: number;
};

/** Push payload for `whisperModelDownloadProgress`. */
export type WhisperDownloadProgress = {
  name: WhisperModelName;
  pct: number;
  done: boolean;
  error?: string;
};

export interface WhisperApi {
  getModels(): Promise<WhisperModelStatus[]>;
  downloadModel(name: string): Promise<void>;
  cancelDownload(): Promise<void>;
  deleteModel(name: string): Promise<void>;
  onDownloadProgress(cb: (e: WhisperDownloadProgress) => void): () => void;
}

// ─── Calendar integration (ROADMAP_06) ──────────────────────────────────────

export const CalendarProviderIdSchema = z.enum(['google', 'microsoft']);

export const CalendarAttendeeSchema = z.object({
  name: z.string().optional(),
  email: z.string(),
});

export const CalendarEventSchema = z.object({
  providerId: CalendarProviderIdSchema,
  externalId: z.string(),
  title: z.string(),
  startMs: z.number().int(),
  endMs: z.number().int(),
  allDay: z.boolean(),
  attendees: z.array(CalendarAttendeeSchema),
  joinUrl: z.string().optional(),
}) satisfies z.ZodType<CalendarEvent>;

export const AgendaEventSchema = CalendarEventSchema.extend({
  armed: z.boolean(),
  meetingId: MeetingIdSchema.nullable(),
}) satisfies z.ZodType<AgendaEvent>;

export const AgendaListSchema = z.array(AgendaEventSchema);

export const CalendarArmSchema = z.object({
  providerId: CalendarProviderIdSchema,
  externalId: z.string().min(1),
  armed: z.boolean(),
});
export type CalendarArmInput = z.infer<typeof CalendarArmSchema>;

export const CalendarLinkSchema = z.object({
  providerId: CalendarProviderIdSchema,
  externalId: z.string().min(1),
  meetingId: MeetingIdSchema,
});
export type CalendarLinkInput = z.infer<typeof CalendarLinkSchema>;

/**
 * Read-only calendar integration. Exposes only event metadata + connection
 * booleans — OAuth tokens NEVER cross this bridge (CLAUDE.md §1.2).
 */
export interface CalendarApi {
  getAgenda(): Promise<AgendaEvent[]>;
  /** Runs the provider's OAuth flow in the system browser; resolves on success. */
  connect(providerId: CalendarProviderId): Promise<void>;
  /** Revokes + clears the provider's tokens and removes its cached events. */
  disconnect(providerId: CalendarProviderId): Promise<void>;
  /** Force a re-sync of all connected providers. */
  refresh(): Promise<void>;
  /** Opt a single event in/out of auto-start. Returns the updated agenda row. */
  armEvent(providerId: CalendarProviderId, externalId: string, armed: boolean): Promise<AgendaEvent>;
  /** Link a created meeting back to its calendar event. */
  linkMeeting(providerId: CalendarProviderId, externalId: string, meetingId: number): Promise<void>;
  /** Pushed whenever the merged agenda changes (sync, arm, connect/disconnect). */
  onAgenda(cb: (events: AgendaEvent[]) => void): () => void;
}

// ─── Cross-meeting intelligence (ROADMAP_07 Phase 1: per-meeting chat) ───────

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
}) satisfies z.ZodType<ChatMessage>;

/**
 * Ask a question about one meeting. `messages` is the full ephemeral
 * conversation so far (last entry is the new user turn); the main process is
 * stateless between asks (CLAUDE.md §07 Phase 1 — no chat persistence).
 */
export const ChatAskSchema = z.object({
  meetingId: MeetingIdSchema,
  messages: z.array(ChatMessageSchema).min(1),
});
export type ChatAskInput = z.infer<typeof ChatAskSchema>;

/** Push payload for a streamed answer delta (validated in preload, like AgendaListSchema). */
export const ChatTokenSchema = z.object({
  requestId: z.string(),
  token: z.string(),
});
export type ChatToken = z.infer<typeof ChatTokenSchema>;

/**
 * Final result of an ask, returned when the stream completes.
 * `citationIds` are transcript segment ids the answer cited, already validated
 * against the meeting's real segments (hallucinated ids dropped). `degraded` is
 * true when the answer could not be grounded (e.g. summarized long transcript).
 */
export type ChatResult = {
  text: string;
  citationIds: number[];
  degraded: boolean;
};

// ─── Cross-meeting querying (ROADMAP_07 Phase 2) ─────────────────────────────

/** Which meetings a cross-meeting query covers; no selection ('all') vs an explicit set. */
export const RetrievalScopeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('meetings'), meetingIds: z.array(MeetingIdSchema).min(1) }),
  z.object({ mode: z.literal('folder'), folderId: MeetingIdSchema }),
  z.object({ mode: z.literal('tag'), tagId: MeetingIdSchema }),
]) satisfies z.ZodType<RetrievalScope>;

export const CrossChatAskSchema = z.object({
  scope: RetrievalScopeSchema,
  messages: z.array(ChatMessageSchema).min(1),
});
export type CrossChatAskInput = z.infer<typeof CrossChatAskSchema>;

/**
 * Final result of a cross-meeting ask. `citations` carry the source meeting (ids
 * are validated against the retrieved segments). `usage` is returned for the UI's
 * per-query cost readout — a cross-meeting query spans many meetings, so it is NOT
 * attributed to any single meeting's usage row (unlike per-meeting chat).
 */
export type CrossChatResult = {
  text: string;
  citations: CrossChatCitation[];
  degraded: boolean;
  usage: { inputTokens: number; outputTokens: number };
};

/** Per-meeting chat + cross-meeting querying. Answers stream via onToken. */
export interface ChatApi {
  ask(input: ChatAskInput): Promise<ChatResult>;
  askAcross(input: CrossChatAskInput): Promise<CrossChatResult>;
  onToken(cb: (e: ChatToken) => void): () => void;
}

// ─── Note organization — folders + tags (ROADMAP_V04_04) ─────────────────────

export const FolderCreateSchema = z.object({
  name: z.string().min(1).max(80),
  parentId: MeetingIdSchema.nullable(),
});
export const FolderRenameSchema = z.object({ id: MeetingIdSchema, name: z.string().min(1).max(80) });
export const FolderMoveSchema = z.object({ id: MeetingIdSchema, parentId: MeetingIdSchema.nullable() });
export const TagNameSchema = z.string().min(1).max(40);
export const MeetingSetFolderSchema = z.object({
  meetingId: MeetingIdSchema,
  folderId: MeetingIdSchema.nullable(),
});
export const MeetingTagSchema = z.object({ meetingId: MeetingIdSchema, tagId: MeetingIdSchema });

/** Folders + tags management. Folder delete nulls its meetings (never deletes them). */
export interface OrganizationApi {
  listFolders(): Promise<Folder[]>;
  createFolder(name: string, parentId: number | null): Promise<Folder>;
  renameFolder(id: number, name: string): Promise<void>;
  moveFolder(id: number, parentId: number | null): Promise<void>;
  deleteFolder(id: number): Promise<void>;
  listTags(): Promise<Tag[]>;
  createTag(name: string): Promise<Tag>;
  deleteTag(id: number): Promise<void>;
  setMeetingFolder(meetingId: number, folderId: number | null): Promise<void>;
  addMeetingTag(meetingId: number, tagId: number): Promise<void>;
  removeMeetingTag(meetingId: number, tagId: number): Promise<void>;
}

/** The typed surface exposed to the renderer as window.api. */
export interface ScribeApi {
  getStatus(): Promise<AppStatus>;
  startTranscription(opts: TranscriptionStart): Promise<void>;
  stopTranscription(): Promise<void>;
  pushAudioFrame(pcm: ArrayBuffer, micLevel: number, sysLevel: number): void;
  onTranscriptSegment(cb: (seg: TranscriptSegment) => void): () => void;
  onTranscriptionStatus(cb: (status: TranscriptionStatus) => void): () => void;
  /** Fires once when Deepgram (or LLM layer) identifies the transcript language. */
  onTranscriptionLanguage(cb: (lang: TranscriptionLanguage) => void): () => void;
  meetings: MeetingsApi;
  templates: TemplatesApi;
  speakers: SpeakersApi;
  organization: OrganizationApi;
  enhance(meetingId: number): Promise<EnhanceResult>;
  settings: SettingsApi;
  theme: ThemeApi;
  export: ExportApi;
  whisper: WhisperApi;
  calendar: CalendarApi;
  chat: ChatApi;
}
