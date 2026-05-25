// The single source of truth for every IPC channel (CLAUDE.md §4).
// Each channel is declared once here with a Zod schema for its request payload.
// ipcMain handlers validate inbound requests against these before acting; the
// preload bridge wires window.api methods to these channel names. The one
// exception is the audio frame channel, a raw ArrayBuffer not validated per-frame.
import { z } from 'zod';
import type { MeetingDetail, MeetingSummary, TranscriptSegment } from './types';

export const IPC = {
  appGetStatus: 'app:getStatus',

  transcriptionStart: 'transcription:start',
  transcriptionStop: 'transcription:stop',
  transcriptionPushFrame: 'transcription:pushFrame', // renderer -> main, raw PCM
  transcriptionSegment: 'transcription:segment', // main -> renderer
  transcriptionStatus: 'transcription:status', // main -> renderer

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

export interface MeetingsApi {
  list(): Promise<MeetingSummary[]>;
  create(): Promise<MeetingSummary>;
  get(id: number): Promise<MeetingDetail | null>;
  getTranscript(id: number): Promise<TranscriptSegment[]>;
  saveNotes(id: number, markdown: string): Promise<void>;
  updateTitle(id: number, title: string): Promise<void>;
  start(id: number): Promise<MeetingSummary>;
  end(id: number): Promise<MeetingSummary>;
  remove(id: number): Promise<void>;
  search(query: string): Promise<MeetingSummary[]>;
}

/** The typed surface exposed to the renderer as window.api. */
export interface ScribeApi {
  getStatus(): Promise<AppStatus>;
  startTranscription(opts: TranscriptionStart): Promise<void>;
  stopTranscription(): Promise<void>;
  pushAudioFrame(pcm: ArrayBuffer): void;
  onTranscriptSegment(cb: (seg: TranscriptSegment) => void): () => void;
  onTranscriptionStatus(cb: (status: TranscriptionStatus) => void): () => void;
  meetings: MeetingsApi;
}
