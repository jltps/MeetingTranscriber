/**
 * getSchedule → CalendarEvent mapping tests (ROADMAP_06 Phase 2). Pure, no
 * Electron/network. Mirrors tests/calendar-freebusy.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  calendarViewToEvents,
  scheduleToEvents,
  type CalendarViewEvent,
  type ScheduleItem,
} from '../src/main/calendar/microsoft-provider';

// Graph getSchedule returns UTC datetimes with 7 fractional digits and no 'Z'
// (we send Prefer: outlook.timezone="UTC"). The mapper appends 'Z' to parse UTC.
function item(status: string, start: string, end: string): ScheduleItem {
  return {
    status,
    start: { dateTime: start, timeZone: 'UTC' },
    end: { dateTime: end, timeZone: 'UTC' },
  };
}

describe('scheduleToEvents', () => {
  it('maps a busy slot to an event with empty metadata, parsing UTC datetimes', () => {
    const events = scheduleToEvents([
      item('busy', '2026-06-01T10:00:00.0000000', '2026-06-01T10:30:00.0000000'),
    ]);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.providerId).toBe('microsoft');
    expect(e.startMs).toBe(Date.parse('2026-06-01T10:00:00Z'));
    expect(e.endMs).toBe(Date.parse('2026-06-01T10:30:00Z'));
    expect(e.title).toBe('');
    expect(e.attendees).toEqual([]);
    expect(e.joinUrl).toBeUndefined();
    expect(e.allDay).toBe(false);
  });

  it('keeps busy/tentative/oof and drops free/workingElsewhere/unknown', () => {
    const events = scheduleToEvents([
      item('busy', '2026-06-01T09:00:00.0000000', '2026-06-01T09:30:00.0000000'),
      item('tentative', '2026-06-01T10:00:00.0000000', '2026-06-01T10:30:00.0000000'),
      item('oof', '2026-06-01T11:00:00.0000000', '2026-06-01T11:30:00.0000000'),
      item('free', '2026-06-01T12:00:00.0000000', '2026-06-01T12:30:00.0000000'),
      item('workingElsewhere', '2026-06-01T13:00:00.0000000', '2026-06-01T13:30:00.0000000'),
      item('unknown', '2026-06-01T14:00:00.0000000', '2026-06-01T14:30:00.0000000'),
    ]);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.startMs)).toEqual([
      Date.parse('2026-06-01T09:00:00Z'),
      Date.parse('2026-06-01T10:00:00Z'),
      Date.parse('2026-06-01T11:00:00Z'),
    ]);
  });

  it('derives a stable externalId from start+end (survives re-runs)', () => {
    const slot = [item('busy', '2026-06-01T10:00:00.0000000', '2026-06-01T10:30:00.0000000')];
    const a = scheduleToEvents(slot)[0].externalId;
    const b = scheduleToEvents(slot)[0].externalId;
    expect(a).toBe(b);
    const other = scheduleToEvents([
      item('busy', '2026-06-01T11:00:00.0000000', '2026-06-01T11:30:00.0000000'),
    ])[0];
    expect(other.externalId).not.toBe(a);
  });

  it('respects an explicit timezone designator when present', () => {
    const events = scheduleToEvents([
      {
        status: 'busy',
        start: { dateTime: '2026-06-01T10:00:00+02:00', timeZone: 'W. Europe Standard Time' },
        end: { dateTime: '2026-06-01T10:30:00+02:00', timeZone: 'W. Europe Standard Time' },
      },
    ]);
    expect(events[0].startMs).toBe(Date.parse('2026-06-01T08:00:00Z'));
  });

  it('returns an empty array for no items', () => {
    expect(scheduleToEvents([])).toEqual([]);
  });

  it('skips items with unparseable timestamps', () => {
    const events = scheduleToEvents([
      item('busy', 'not-a-date', '2026-06-01T10:30:00.0000000'),
      item('busy', '2026-06-01T12:00:00.0000000', '2026-06-01T12:30:00.0000000'),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].startMs).toBe(Date.parse('2026-06-01T12:00:00Z'));
  });
});

// calendarView fallback (personal accounts) — same busy filter + empty-title output
// as getSchedule, but carries isAllDay through.
function cv(showAs: string, start: string, end: string, isAllDay = false): CalendarViewEvent {
  return {
    showAs,
    isAllDay,
    start: { dateTime: start, timeZone: 'UTC' },
    end: { dateTime: end, timeZone: 'UTC' },
  };
}

describe('calendarViewToEvents', () => {
  it('maps a busy event to an empty-title CalendarEvent, parsing UTC datetimes', () => {
    const events = calendarViewToEvents([
      cv('busy', '2026-06-01T10:00:00.0000000', '2026-06-01T10:30:00.0000000'),
    ]);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.providerId).toBe('microsoft');
    expect(e.startMs).toBe(Date.parse('2026-06-01T10:00:00Z'));
    expect(e.title).toBe('');
    expect(e.attendees).toEqual([]);
    expect(e.allDay).toBe(false);
    expect(e.externalId).toBe(`${e.startMs}-${e.endMs}`);
  });

  it('keeps busy/tentative/oof and drops free/workingElsewhere/unknown', () => {
    const events = calendarViewToEvents([
      cv('busy', '2026-06-01T09:00:00.0000000', '2026-06-01T09:30:00.0000000'),
      cv('tentative', '2026-06-01T10:00:00.0000000', '2026-06-01T10:30:00.0000000'),
      cv('oof', '2026-06-01T11:00:00.0000000', '2026-06-01T11:30:00.0000000'),
      cv('free', '2026-06-01T12:00:00.0000000', '2026-06-01T12:30:00.0000000'),
      cv('workingElsewhere', '2026-06-01T13:00:00.0000000', '2026-06-01T13:30:00.0000000'),
    ]);
    expect(events).toHaveLength(3);
  });

  it('carries isAllDay through (so the scheduler can skip all-day blocks)', () => {
    const events = calendarViewToEvents([
      cv('oof', '2026-06-01T00:00:00.0000000', '2026-06-02T00:00:00.0000000', true),
    ]);
    expect(events[0].allDay).toBe(true);
  });

  it('returns an empty array for no events and skips unparseable timestamps', () => {
    expect(calendarViewToEvents([])).toEqual([]);
    const skipped = calendarViewToEvents([
      cv('busy', 'not-a-date', '2026-06-01T10:30:00.0000000'),
    ]);
    expect(skipped).toEqual([]);
  });
});
