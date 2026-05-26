import { ipcMain } from 'electron';
import {
  CalendarArmSchema,
  CalendarLinkSchema,
  CalendarProviderIdSchema,
  IPC,
} from '../../shared/ipc-contract';
import type { AgendaEvent } from '../../shared/types';
import {
  disconnectProvider,
  getProvider,
  pushAgenda,
  startCalendarSync,
  syncNow,
} from '../calendar';
import { linkMeetingToEvent, listAgendaEvents, setEventArmed } from '../db/calendar';
import { logger } from '../logger';

// Calendar IPC (ROADMAP_06). Every inbound payload is Zod-validated before acting
// (CLAUDE.md §4). Tokens never cross this bridge — only event metadata + the
// merged agenda are exposed. Agenda changes are pushed via IPC.calendarAgenda.
export function registerCalendarIpc(): void {
  // Resume the poll loop if a provider is already connected from a prior session.
  startCalendarSync();

  ipcMain.handle(IPC.calendarGetAgenda, (): AgendaEvent[] => listAgendaEvents());

  ipcMain.handle(IPC.calendarConnect, async (_event, raw) => {
    const id = CalendarProviderIdSchema.parse(raw);
    await getProvider(id).connect();
    // Fetch immediately and start polling now that we're connected.
    await syncNow();
    startCalendarSync();
  });

  ipcMain.handle(IPC.calendarDisconnect, async (_event, raw) => {
    const id = CalendarProviderIdSchema.parse(raw);
    await disconnectProvider(id);
    logger.info(`Calendar disconnected: ${id}`);
  });

  ipcMain.handle(IPC.calendarRefresh, async () => {
    await syncNow();
  });

  ipcMain.handle(IPC.calendarArmEvent, (_event, raw): AgendaEvent => {
    const { providerId, externalId, armed } = CalendarArmSchema.parse(raw);
    const updated = setEventArmed(providerId, externalId, armed);
    pushAgenda();
    if (!updated) throw new Error('Calendar event not found.');
    return updated;
  });

  ipcMain.handle(IPC.calendarLinkMeeting, (_event, raw) => {
    const { providerId, externalId, meetingId } = CalendarLinkSchema.parse(raw);
    linkMeetingToEvent(providerId, externalId, meetingId);
    // The renderer re-reads the link via the agenda push.
    pushAgenda();
  });
}
