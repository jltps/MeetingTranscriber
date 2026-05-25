import { ipcMain } from 'electron';
import {
  IPC,
  MeetingIdSchema,
  SaveNotesSchema,
  SearchQuerySchema,
  UpdateTitleSchema,
} from '../../shared/ipc-contract';
import * as meetings from '../db/meetings';

// Meeting/notes/transcript CRUD over IPC. Every inbound argument is Zod-validated
// before touching the database (CLAUDE.md §4). Responses originate from our own
// SQLite, so they are returned without re-validation.
export function registerMeetingsIpc(): void {
  ipcMain.handle(IPC.meetingsList, () => meetings.listMeetings());
  ipcMain.handle(IPC.meetingsCreate, () => meetings.createMeeting());
  ipcMain.handle(IPC.meetingsGet, (_event, raw) => meetings.getMeeting(MeetingIdSchema.parse(raw)));
  ipcMain.handle(IPC.meetingsGetTranscript, (_event, raw) =>
    meetings.getTranscript(MeetingIdSchema.parse(raw)),
  );
  ipcMain.handle(IPC.meetingsSaveNotes, (_event, raw) => {
    const input = SaveNotesSchema.parse(raw);
    meetings.saveNotes(input.id, input.markdown);
  });
  ipcMain.handle(IPC.meetingsUpdateTitle, (_event, raw) => {
    const input = UpdateTitleSchema.parse(raw);
    meetings.updateTitle(input.id, input.title);
  });
  ipcMain.handle(IPC.meetingsStart, (_event, raw) => meetings.startMeeting(MeetingIdSchema.parse(raw)));
  ipcMain.handle(IPC.meetingsEnd, (_event, raw) => meetings.endMeeting(MeetingIdSchema.parse(raw)));
  ipcMain.handle(IPC.meetingsDelete, (_event, raw) => meetings.deleteMeeting(MeetingIdSchema.parse(raw)));
  ipcMain.handle(IPC.meetingsSearch, (_event, raw) =>
    meetings.searchMeetings(SearchQuerySchema.parse(raw)),
  );
}
