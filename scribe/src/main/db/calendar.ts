import { getDb } from './index';
import type { AgendaEvent, CalendarEvent, CalendarProviderId } from '../../shared/types';

// Local cache of calendar events + the meeting↔event link (ROADMAP_06). DB access
// stays in the main process; the renderer reaches it via IPC. Pattern mirrors
// db/speakers.ts. No tokens here — those live encrypted in the `settings` table.

type CalendarEventRow = {
  provider_id: string;
  external_id: string;
  title: string;
  start_ms: number;
  end_ms: number;
  all_day: number;
  join_url: string | null;
  attendees_json: string;
  armed: number;
  meeting_id: number | null;
};

function toAgendaEvent(row: CalendarEventRow): AgendaEvent {
  let attendees: AgendaEvent['attendees'] = [];
  try {
    const parsed: unknown = JSON.parse(row.attendees_json);
    if (Array.isArray(parsed)) attendees = parsed as AgendaEvent['attendees'];
  } catch {
    /* malformed cache row — treat as no attendees */
  }
  return {
    providerId: row.provider_id as CalendarProviderId,
    externalId: row.external_id,
    title: row.title,
    startMs: row.start_ms,
    endMs: row.end_ms,
    allDay: row.all_day === 1,
    joinUrl: row.join_url ?? undefined,
    attendees,
    armed: row.armed === 1,
    meetingId: row.meeting_id,
  };
}

/**
 * Insert or update a batch of freshly-synced events for one provider.
 * `armed` and any meeting link are preserved across re-syncs (ON CONFLICT only
 * touches the mutable metadata), so a poll never clobbers the user's choices.
 */
export function upsertEvents(providerId: CalendarProviderId, events: CalendarEvent[]): void {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO calendar_events
       (provider_id, external_id, title, start_ms, end_ms, all_day, join_url, attendees_json, armed, synced_at)
     VALUES (@provider_id, @external_id, @title, @start_ms, @end_ms, @all_day, @join_url, @attendees_json, 0, @synced_at)
     ON CONFLICT(provider_id, external_id) DO UPDATE SET
       title          = excluded.title,
       start_ms       = excluded.start_ms,
       end_ms         = excluded.end_ms,
       all_day        = excluded.all_day,
       join_url       = excluded.join_url,
       attendees_json = excluded.attendees_json,
       synced_at      = excluded.synced_at`,
  );
  const run = db.transaction((rows: CalendarEvent[]) => {
    for (const e of rows) {
      stmt.run({
        provider_id: providerId,
        external_id: e.externalId,
        title: e.title,
        start_ms: e.startMs,
        end_ms: e.endMs,
        all_day: e.allDay ? 1 : 0,
        join_url: e.joinUrl ?? null,
        attendees_json: JSON.stringify(e.attendees ?? []),
        synced_at: now,
      });
    }
  });
  run(events);
}

/**
 * Remove events that are no longer in the sync window so the agenda doesn't show
 * stale rows. Deletes this provider's events that ended before `cutoffMs` OR are
 * not in the freshly-synced set (by external id). Armed events with a linked
 * meeting are left to the FK (the meeting is unaffected by the event's deletion).
 */
export function pruneEvents(providerId: CalendarProviderId, keepExternalIds: string[], cutoffMs: number): void {
  const db = getDb();
  const keep = new Set(keepExternalIds);
  const rows = db
    .prepare(`SELECT external_id, end_ms FROM calendar_events WHERE provider_id = ?`)
    .all(providerId) as { external_id: string; end_ms: number }[];
  const del = db.prepare(`DELETE FROM calendar_events WHERE provider_id = ? AND external_id = ?`);
  const run = db.transaction(() => {
    for (const r of rows) {
      if (!keep.has(r.external_id) || r.end_ms < cutoffMs) del.run(providerId, r.external_id);
    }
  });
  run();
}

/** Remove all cached events for a provider (used on disconnect). */
export function clearProviderEvents(providerId: CalendarProviderId): void {
  getDb().prepare(`DELETE FROM calendar_events WHERE provider_id = ?`).run(providerId);
}

/**
 * The merged agenda across all providers, sorted by start time, joined to any
 * linked meeting. Provider-agnostic so a second provider merges in for free.
 */
export function listAgendaEvents(): AgendaEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT ce.provider_id, ce.external_id, ce.title, ce.start_ms, ce.end_ms,
              ce.all_day, ce.join_url, ce.attendees_json, ce.armed,
              m.id AS meeting_id
         FROM calendar_events ce
         LEFT JOIN meetings m ON m.calendar_event_id = ce.id
        ORDER BY ce.start_ms ASC`,
    )
    .all() as CalendarEventRow[];
  return rows.map(toAgendaEvent);
}

/** Set the armed flag for one event; returns the updated agenda row. */
export function setEventArmed(
  providerId: CalendarProviderId,
  externalId: string,
  armed: boolean,
): AgendaEvent | null {
  getDb()
    .prepare(`UPDATE calendar_events SET armed = ? WHERE provider_id = ? AND external_id = ?`)
    .run(armed ? 1 : 0, providerId, externalId);
  return getAgendaEvent(providerId, externalId);
}

export function getAgendaEvent(
  providerId: CalendarProviderId,
  externalId: string,
): AgendaEvent | null {
  const row = getDb()
    .prepare(
      `SELECT ce.provider_id, ce.external_id, ce.title, ce.start_ms, ce.end_ms,
              ce.all_day, ce.join_url, ce.attendees_json, ce.armed,
              m.id AS meeting_id
         FROM calendar_events ce
         LEFT JOIN meetings m ON m.calendar_event_id = ce.id
        WHERE ce.provider_id = ? AND ce.external_id = ?`,
    )
    .get(providerId, externalId) as CalendarEventRow | undefined;
  return row ? toAgendaEvent(row) : null;
}

/** Link a meeting back to the calendar event it was started from. */
export function linkMeetingToEvent(
  providerId: CalendarProviderId,
  externalId: string,
  meetingId: number,
): void {
  const row = getDb()
    .prepare(`SELECT id FROM calendar_events WHERE provider_id = ? AND external_id = ?`)
    .get(providerId, externalId) as { id: number } | undefined;
  if (!row) return;
  getDb().prepare(`UPDATE meetings SET calendar_event_id = ? WHERE id = ?`).run(row.id, meetingId);
}
