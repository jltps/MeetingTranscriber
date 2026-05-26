// The single source of truth for every IPC channel (CLAUDE.md §4).
// Each channel is declared once here with a Zod schema for its request payload.
// ipcMain handlers validate inbound requests against these before acting; the
// preload bridge wires window.api methods to these channel names. The one
// exception is the audio frame channel, a raw ArrayBuffer not validated per-frame.
import { z } from 'zod';
import type {
  EnhancedNotes,
  LanguageSetting,
  MeetingDetail,
  MeetingSummary,
  PersistedSegment,
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

  settingsGet: 'settings:get',
  settingsSetKeys: 'settings:setKeys',
  settingsSetMicDevice: 'settings:setMicDevice',
  settingsSetLanguage: 'settings:setLanguage',
  settingsSetGlobalInstructions: 'settings:setGlobalInstructions',
  settingsTest: 'settings:test',
  settingsAcceptPrivacy: 'settings:acceptPrivacy',
  settingsWipe: 'settings:wipe',
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
  state: z.enum(['open', 'closed', 'error']),
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

export type SettingsView = {
  deepgramKeySet: boolean;
  anthropicKeySet: boolean;
  micDeviceId: string | null;
  language: LanguageSetting;
  /** Free-text instructions appended to every enhancement (FEATURES §B1). */
  globalInstructions: string;
  privacyAccepted: boolean;
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
  test(provider: TestProvider, key?: string): Promise<TestResult>;
  acceptPrivacy(): Promise<void>;
  wipe(): Promise<void>;
}

/** The typed surface exposed to the renderer as window.api. */
export interface ScribeApi {
  getStatus(): Promise<AppStatus>;
  startTranscription(opts: TranscriptionStart): Promise<void>;
  stopTranscription(): Promise<void>;
  pushAudioFrame(pcm: ArrayBuffer): void;
  onTranscriptSegment(cb: (seg: TranscriptSegment) => void): () => void;
  onTranscriptionStatus(cb: (status: TranscriptionStatus) => void): () => void;
  /** Fires once when Deepgram (or LLM layer) identifies the transcript language. */
  onTranscriptionLanguage(cb: (lang: TranscriptionLanguage) => void): () => void;
  meetings: MeetingsApi;
  templates: TemplatesApi;
  enhance(meetingId: number): Promise<EnhanceResult>;
  settings: SettingsApi;
}
