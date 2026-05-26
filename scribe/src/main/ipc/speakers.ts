import { ipcMain } from 'electron';
import {
  IPC,
  MeetingIdSchema,
  SpeakersClearSchema,
  SpeakersReassignSchema,
  SpeakersSetSchema,
} from '../../shared/ipc-contract';
import {
  clearSpeakerName,
  getSpeakerNames,
  reassignSegment,
  setSpeakerName,
} from '../db/speakers';

// Speaker naming IPC (ROADMAP_02). All four channels are validated with Zod before
// touching the DB. Pattern matches ipc/templates.ts and ipc/settings.ts.
export function registerSpeakersIpc(): void {
  ipcMain.handle(IPC.speakersGet, (_event, raw) => {
    const meetingId = MeetingIdSchema.parse(raw);
    return getSpeakerNames(meetingId);
  });

  ipcMain.handle(IPC.speakersSet, (_event, raw) => {
    const { meetingId, rawLabel, displayName } = SpeakersSetSchema.parse(raw);
    setSpeakerName(meetingId, rawLabel, displayName);
  });

  ipcMain.handle(IPC.speakersClear, (_event, raw) => {
    const { meetingId, rawLabel } = SpeakersClearSchema.parse(raw);
    clearSpeakerName(meetingId, rawLabel);
  });

  ipcMain.handle(IPC.speakersReassign, (_event, raw) => {
    const { meetingId, segmentId, newRawLabel } = SpeakersReassignSchema.parse(raw);
    reassignSegment(meetingId, segmentId, newRawLabel);
  });
}
