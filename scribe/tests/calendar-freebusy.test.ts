/**
 * Freebusy → CalendarEvent mapping tests (ROADMAP_06). Pure, no Electron/network.
 */
import { describe, it, expect } from 'vitest';
import { busyToEvents } from '../src/main/calendar/google-provider';

describe('busyToEvents', () => {
  it('maps busy slots to events with empty metadata', () => {
    const events = busyToEvents([
      { start: '2026-06-01T10:00:00Z', end: '2026-06-01T10:30:00Z' },
    ]);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.providerId).toBe('google');
    expect(e.startMs).toBe(Date.parse('2026-06-01T10:00:00Z'));
    expect(e.endMs).toBe(Date.parse('2026-06-01T10:30:00Z'));
    expect(e.title).toBe('');
    expect(e.attendees).toEqual([]);
    expect(e.joinUrl).toBeUndefined();
    expect(e.allDay).toBe(false);
  });

  it('derives a stable externalId from start+end (survives re-runs)', () => {
    const slot = [{ start: '2026-06-01T10:00:00Z', end: '2026-06-01T10:30:00Z' }];
    const a = busyToEvents(slot)[0].externalId;
    const b = busyToEvents(slot)[0].externalId;
    expect(a).toBe(b);
    // distinct slots → distinct ids
    const other = busyToEvents([{ start: '2026-06-01T11:00:00Z', end: '2026-06-01T11:30:00Z' }])[0];
    expect(other.externalId).not.toBe(a);
  });

  it('returns an empty array for no busy slots', () => {
    expect(busyToEvents([])).toEqual([]);
  });

  it('skips slots with unparseable timestamps', () => {
    const events = busyToEvents([
      { start: 'not-a-date', end: '2026-06-01T10:30:00Z' },
      { start: '2026-06-01T12:00:00Z', end: '2026-06-01T12:30:00Z' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].startMs).toBe(Date.parse('2026-06-01T12:00:00Z'));
  });
});
