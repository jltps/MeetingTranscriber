import type { CalendarEvent } from '../../shared/types';
import type { CalendarProvider } from './provider';
import { MICROSOFT_OAUTH } from './config';
import { getValidMicrosoftAccessToken, revokeMicrosoft, runMicrosoftOAuth } from './microsoft-oauth';
import { getMicrosoftUserEmail, isMicrosoftConnected } from '../secrets/calendar-tokens';

// Microsoft / Outlook implementation of CalendarProvider (ROADMAP_06 Phase 2). It
// learns *when* the user is busy, never event titles/attendees/links — mirroring
// the Google freebusy provider — via one of two Graph reads chosen by account type:
//   • work/school accounts → getSchedule (free/busy action; busy times only).
//   • personal accounts    → calendarView with a tight $select (start/end/isAllDay/
//     showAs), because getSchedule isn't supported there. The $select means we still
//     never request titles/attendees, so no event content reaches the app.
// Both paths produce the same empty-title CalendarEvent[], so everything downstream
// (agenda, arm/link, scheduler, auto-start) is identical for both providers.

type GraphDateTime = { dateTime: string; timeZone?: string };
export type ScheduleItem = { status?: string; start?: GraphDateTime; end?: GraphDateTime };
type GetScheduleResponse = { value?: Array<{ scheduleItems?: ScheduleItem[] }> };

export type CalendarViewEvent = {
  start?: GraphDateTime;
  end?: GraphDateTime;
  isAllDay?: boolean;
  showAs?: string;
};
type CalendarViewResponse = { value?: CalendarViewEvent[] };

// Free/busy statuses that mean "the user is in something" (vs. free/working
// elsewhere/unknown, which we ignore). getSchedule's `status` and calendarView's
// `showAs` share this enum.
const BUSY_STATUSES = new Set(['busy', 'tentative', 'oof']);

/**
 * Extract Graph's human-readable reason from a failed response. Graph 401s often
 * return an empty body with the real cause only in the `WWW-Authenticate` header
 * (e.g. error_description="...Invalid audience..."), so we surface that too. No
 * secrets are present in either field.
 */
async function readApiError(res: Response): Promise<string> {
  const wwwAuth = res.headers.get('www-authenticate');
  let detail = '';
  try {
    const text = await res.text();
    if (text) {
      try {
        const body = JSON.parse(text) as { error?: { message?: string; code?: string } };
        detail = body.error?.message ?? body.error?.code ?? text;
      } catch {
        detail = text;
      }
    }
  } catch {
    /* body unreadable — fall through to statusText/header */
  }
  if (!detail) detail = res.statusText;
  return wwwAuth ? `${detail} [${wwwAuth}]` : detail;
}

/**
 * Work/school Graph access tokens are JWTs; personal-account ("consumer") tokens
 * are opaque/compact and can't be decoded. We use this only to pick the read path
 * (getSchedule vs. calendarView) — never to trust the token's contents.
 */
function isWorkAccountToken(token: string): boolean {
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a Graph dateTime. We send `Prefer: outlook.timezone="UTC"`, so bare
 * datetimes (no trailing Z/offset) are UTC and get a 'Z' appended; anything that
 * already carries a designator is parsed as-is.
 */
function parseGraphDateTime(dt: GraphDateTime | undefined): number {
  if (!dt?.dateTime) return Number.NaN;
  const s = dt.dateTime;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s);
  return Date.parse(`${s}Z`);
}

/** Shared mapping: a busy {start,end} block → a CalendarEvent, or null if invalid. */
function busyBlockToEvent(
  start: GraphDateTime | undefined,
  end: GraphDateTime | undefined,
  allDay: boolean,
): CalendarEvent | null {
  const startMs = parseGraphDateTime(start);
  const endMs = parseGraphDateTime(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return {
    providerId: 'microsoft',
    externalId: `${startMs}-${endMs}`,
    title: '',
    startMs,
    endMs,
    allDay,
    attendees: [],
  };
}

/**
 * Map getSchedule scheduleItems → CalendarEvent[]. Pure (no I/O) for testability.
 * Keeps only busy/tentative/oof blocks; `externalId` is derived from start+end so
 * it is stable across polls (the upsert preserves `armed`/link); title/attendees/
 * joinUrl are empty because free/busy carries none. Unparseable times are skipped.
 */
export function scheduleToEvents(items: ScheduleItem[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const item of items) {
    if (!item.status || !BUSY_STATUSES.has(item.status)) continue;
    const event = busyBlockToEvent(item.start, item.end, false);
    if (event) events.push(event);
  }
  return events;
}

/**
 * Map calendarView events → CalendarEvent[]. Pure (no I/O) for testability. Same
 * busy filter (on `showAs`) and empty-title output as scheduleToEvents, but carries
 * `isAllDay` through so the scheduler skips all-day blocks.
 */
export function calendarViewToEvents(items: CalendarViewEvent[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const item of items) {
    if (!item.showAs || !BUSY_STATUSES.has(item.showAs)) continue;
    const event = busyBlockToEvent(item.start, item.end, Boolean(item.isAllDay));
    if (event) events.push(event);
  }
  return events;
}

export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly id = 'microsoft' as const;

  isConnected(): boolean {
    return isMicrosoftConnected();
  }

  async connect(): Promise<void> {
    await runMicrosoftOAuth();
  }

  async disconnect(): Promise<void> {
    await revokeMicrosoft();
  }

  async listUpcoming(opts: { fromMs: number; toMs: number }): Promise<CalendarEvent[]> {
    const token = await getValidMicrosoftAccessToken();
    // getSchedule is work/school only; personal accounts use calendarView.
    return isWorkAccountToken(token)
      ? this.viaGetSchedule(token, opts)
      : this.viaCalendarView(token, opts);
  }

  /** Work/school path: getSchedule free/busy on the signed-in mailbox. */
  private async viaGetSchedule(
    token: string,
    opts: { fromMs: number; toMs: number },
  ): Promise<CalendarEvent[]> {
    const email = getMicrosoftUserEmail();
    if (!email) {
      throw new Error('Microsoft Calendar is connected but the account address is unknown — reconnect.');
    }
    const res = await fetch(MICROSOFT_OAUTH.getScheduleEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.timezone="UTC"', // returned dateTimes are UTC
      },
      body: JSON.stringify({
        schedules: [email],
        startTime: { dateTime: new Date(opts.fromMs).toISOString(), timeZone: 'UTC' },
        endTime: { dateTime: new Date(opts.toMs).toISOString(), timeZone: 'UTC' },
        availabilityViewInterval: 60,
      }),
    });
    if (!res.ok) {
      throw new Error(`Microsoft getSchedule failed (${res.status}): ${await readApiError(res)}`);
    }
    const json = (await res.json()) as GetScheduleResponse;
    return scheduleToEvents(json.value?.[0]?.scheduleItems ?? []);
  }

  /**
   * Personal-account path: calendarView with a tight $select so Graph returns only
   * timing + free/busy status, never titles/attendees. Single page (no pagination)
   * — ample for a busy view over the sync window.
   */
  private async viaCalendarView(
    token: string,
    opts: { fromMs: number; toMs: number },
  ): Promise<CalendarEvent[]> {
    const url = new URL(MICROSOFT_OAUTH.calendarViewEndpoint);
    url.searchParams.set('startDateTime', new Date(opts.fromMs).toISOString());
    url.searchParams.set('endDateTime', new Date(opts.toMs).toISOString());
    url.searchParams.set('$select', 'start,end,isAllDay,showAs');
    url.searchParams.set('$orderby', 'start/dateTime');
    url.searchParams.set('$top', '100');
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"', // returned dateTimes are UTC
      },
    });
    if (!res.ok) {
      throw new Error(`Microsoft calendarView failed (${res.status}): ${await readApiError(res)}`);
    }
    const json = (await res.json()) as CalendarViewResponse;
    return calendarViewToEvents(json.value ?? []);
  }
}
