import type { CalendarEvent } from '../../shared/types';
import type { CalendarProvider } from './provider';
import { GOOGLE_OAUTH } from './config';
import { getValidGoogleAccessToken, revokeGoogle, runGoogleOAuth } from './google-oauth';
import { isGoogleConnected } from '../secrets/calendar-tokens';
import { normalizeGoogleEvent, type RawGoogleEvent } from './normalize';

// Google Calendar implementation of CalendarProvider (ROADMAP_06). Read-only:
// it only ever GETs events. Recurrence is expanded server-side (singleEvents=true)
// so each instance arrives as its own event with a distinct id.

type EventsListResponse = { items?: RawGoogleEvent[]; nextPageToken?: string };

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
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;

    // Paginate defensively; a 14-day window is small but recurring series can be busy.
    do {
      const url = new URL(GOOGLE_OAUTH.eventsEndpoint);
      url.searchParams.set('timeMin', new Date(opts.fromMs).toISOString());
      url.searchParams.set('timeMax', new Date(opts.toMs).toISOString());
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '250');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        throw new Error(`Google Calendar request failed: ${res.status}`);
      }
      const json = (await res.json()) as EventsListResponse;
      for (const raw of json.items ?? []) {
        const normalized = normalizeGoogleEvent(raw);
        if (normalized) events.push(normalized);
      }
      pageToken = json.nextPageToken;
    } while (pageToken);

    return events;
  }
}
