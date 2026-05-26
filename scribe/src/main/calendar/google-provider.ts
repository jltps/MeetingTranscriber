import type { CalendarEvent } from '../../shared/types';
import type { CalendarProvider } from './provider';
import { GOOGLE_OAUTH } from './config';
import { getValidGoogleAccessToken, revokeGoogle, runGoogleOAuth } from './google-oauth';
import { isGoogleConnected } from '../secrets/calendar-tokens';

// Google Calendar implementation of CalendarProvider (ROADMAP_06). It uses the
// FREEBUSY API only (scope calendar.freebusy): it learns *when* the user is busy,
// never event titles/attendees/links. Each busy block becomes a CalendarEvent with
// an empty title, so the agenda/auto-start pipeline downstream is unchanged.

type BusySlot = { start: string; end: string };
type FreeBusyResponse = {
  calendars?: Record<string, { busy?: BusySlot[] }>;
};

/** Extract Google's human-readable error message from a failed API response. */
async function readApiError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } };
    return body.error?.message ?? body.error?.status ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

/**
 * Map freebusy busy slots → CalendarEvent[]. Pure (no I/O) for testability.
 * `externalId` is derived from the slot's start+end so it is stable across polls
 * (the upsert preserves `armed`/link); title/attendees/joinUrl are empty because
 * freebusy carries none. Slots with unparseable timestamps are skipped.
 */
export function busyToEvents(busy: BusySlot[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const slot of busy) {
    const startMs = Date.parse(slot.start);
    const endMs = Date.parse(slot.end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
    events.push({
      providerId: 'google',
      externalId: `${startMs}-${endMs}`,
      title: '',
      startMs,
      endMs,
      allDay: false,
      attendees: [],
    });
  }
  return events;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = 'google' as const;

  isConnected(): boolean {
    return isGoogleConnected();
  }

  async connect(): Promise<void> {
    await runGoogleOAuth();
  }

  async disconnect(): Promise<void> {
    await revokeGoogle();
  }

  async listUpcoming(opts: { fromMs: number; toMs: number }): Promise<CalendarEvent[]> {
    const token = await getValidGoogleAccessToken();
    const res = await fetch(GOOGLE_OAUTH.freeBusyEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: new Date(opts.fromMs).toISOString(),
        timeMax: new Date(opts.toMs).toISOString(),
        items: [{ id: 'primary' }],
      }),
    });
    if (!res.ok) {
      // Surface Google's message (e.g. "Calendar API has not been used in project
      // N… or it is disabled. Enable it by visiting …") so the cause is actionable.
      throw new Error(`Google freebusy request failed (${res.status}): ${await readApiError(res)}`);
    }
    const json = (await res.json()) as FreeBusyResponse;
    return busyToEvents(json.calendars?.primary?.busy ?? []);
  }
}
