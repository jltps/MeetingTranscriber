import type { CalendarEvent } from '../../shared/types';

// Pure normalization of a raw Google Calendar event into our provider-agnostic
// CalendarEvent (ROADMAP_06). No I/O, no Electron — unit-testable in isolation.
// Returns null for events that should not appear on the agenda (cancelled,
// self-declined, out-of-office / focus-time blocks).

/** The subset of the Google Calendar `events` resource we read. */
export type RawGoogleEvent = {
  id?: string;
  status?: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary?: string;
  eventType?: string; // 'default' | 'outOfOffice' | 'focusTime' | 'workingLocation'
  start?: GoogleDate;
  end?: GoogleDate;
  attendees?: GoogleAttendee[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

type GoogleDate = { dateTime?: string; date?: string; timeZone?: string };
type GoogleAttendee = {
  email?: string;
  displayName?: string;
  self?: boolean;
  responseStatus?: string; // 'needsAction' | 'declined' | 'tentative' | 'accepted'
};

type ParsedTime = { ms: number; allDay: boolean };

/** All-day dates ('YYYY-MM-DD') are interpreted at local midnight. */
function parseGoogleDate(d: GoogleDate | undefined): ParsedTime | null {
  if (!d) return null;
  if (d.date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.date);
    if (!m) return null;
    const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    return { ms, allDay: true };
  }
  if (d.dateTime) {
    // RFC-3339 with offset (Google includes one) — Date.parse handles it.
    const ms = Date.parse(d.dateTime);
    if (Number.isNaN(ms)) return null;
    return { ms, allDay: false };
  }
  return null;
}

function extractJoinUrl(raw: RawGoogleEvent): string | undefined {
  if (raw.hangoutLink) return raw.hangoutLink;
  const video = raw.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  return video?.uri;
}

export function normalizeGoogleEvent(raw: RawGoogleEvent): CalendarEvent | null {
  if (!raw.id) return null;
  if (raw.status === 'cancelled') return null;
  // Non-meeting blocks should never auto-start or clutter the agenda.
  if (raw.eventType === 'outOfOffice' || raw.eventType === 'focusTime' || raw.eventType === 'workingLocation') {
    return null;
  }
  // Drop events the user has declined.
  const self = raw.attendees?.find((a) => a.self);
  if (self?.responseStatus === 'declined') return null;

  const start = parseGoogleDate(raw.start);
  const end = parseGoogleDate(raw.end);
  if (!start || !end) return null;

  const attendees = (raw.attendees ?? [])
    .filter((a): a is GoogleAttendee & { email: string } => typeof a.email === 'string' && a.email.length > 0)
    .map((a) => (a.displayName ? { email: a.email, name: a.displayName } : { email: a.email }));

  return {
    providerId: 'google',
    externalId: raw.id,
    title: raw.summary?.trim() || 'Untitled event',
    startMs: start.ms,
    endMs: end.ms,
    allDay: start.allDay,
    attendees,
    joinUrl: extractJoinUrl(raw),
  };
}
