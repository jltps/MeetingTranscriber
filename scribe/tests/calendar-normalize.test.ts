/**
 * Google event normalization tests (ROADMAP_06). Pure — no Electron/network.
 * Covers timezone handling, all-day, recurring instances, declined/cancelled/OOO
 * filtering, join-link extraction, and attendee mapping.
 */
import { describe, it, expect } from 'vitest';
import { normalizeGoogleEvent, type RawGoogleEvent } from '../src/main/calendar/normalize';

describe('normalizeGoogleEvent', () => {
  it('normalizes a timed event with an explicit offset', () => {
    const raw: RawGoogleEvent = {
      id: 'evt1',
      status: 'confirmed',
      summary: 'Standup',
      start: { dateTime: '2026-06-01T10:00:00-07:00' },
      end: { dateTime: '2026-06-01T10:30:00-07:00' },
    };
    const e = normalizeGoogleEvent(raw);
    expect(e).not.toBeNull();
    expect(e?.providerId).toBe('google');
    expect(e?.externalId).toBe('evt1');
    expect(e?.title).toBe('Standup');
    expect(e?.allDay).toBe(false);
    expect(e?.startMs).toBe(Date.parse('2026-06-01T10:00:00-07:00'));
    expect(e?.endMs).toBe(Date.parse('2026-06-01T10:30:00-07:00'));
  });

  it('marks all-day events and parses the date', () => {
    const e = normalizeGoogleEvent({
      id: 'allday',
      summary: 'Conference',
      start: { date: '2026-06-02' },
      end: { date: '2026-06-03' },
    });
    expect(e?.allDay).toBe(true);
    expect(e?.startMs).toBe(new Date(2026, 5, 2).getTime());
  });

  it('keeps distinct ids for recurring instances (server-expanded)', () => {
    const a = normalizeGoogleEvent({
      id: 'series_20260601T100000Z',
      start: { dateTime: '2026-06-01T10:00:00Z' },
      end: { dateTime: '2026-06-01T10:30:00Z' },
    });
    const b = normalizeGoogleEvent({
      id: 'series_20260602T100000Z',
      start: { dateTime: '2026-06-02T10:00:00Z' },
      end: { dateTime: '2026-06-02T10:30:00Z' },
    });
    expect(a?.externalId).not.toBe(b?.externalId);
  });

  it('drops cancelled events', () => {
    expect(
      normalizeGoogleEvent({
        id: 'x',
        status: 'cancelled',
        start: { dateTime: '2026-06-01T10:00:00Z' },
        end: { dateTime: '2026-06-01T10:30:00Z' },
      }),
    ).toBeNull();
  });

  it('drops events the user has declined', () => {
    expect(
      normalizeGoogleEvent({
        id: 'x',
        start: { dateTime: '2026-06-01T10:00:00Z' },
        end: { dateTime: '2026-06-01T10:30:00Z' },
        attendees: [{ email: 'me@x.com', self: true, responseStatus: 'declined' }],
      }),
    ).toBeNull();
  });

  it('drops out-of-office and focus-time blocks', () => {
    for (const eventType of ['outOfOffice', 'focusTime', 'workingLocation']) {
      expect(
        normalizeGoogleEvent({
          id: 'x',
          eventType,
          start: { dateTime: '2026-06-01T10:00:00Z' },
          end: { dateTime: '2026-06-01T10:30:00Z' },
        }),
      ).toBeNull();
    }
  });

  it('drops events without a parseable start/end', () => {
    expect(normalizeGoogleEvent({ id: 'x', start: {}, end: {} })).toBeNull();
    expect(normalizeGoogleEvent({ start: { dateTime: '2026-06-01T10:00:00Z' } })).toBeNull(); // no id
  });

  it('maps attendees and prefers hangoutLink for joinUrl', () => {
    const e = normalizeGoogleEvent({
      id: 'x',
      summary: 'Sync',
      start: { dateTime: '2026-06-01T10:00:00Z' },
      end: { dateTime: '2026-06-01T10:30:00Z' },
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      attendees: [
        { email: 'ana@x.com', displayName: 'Ana' },
        { email: 'bob@x.com' },
        { displayName: 'Room' }, // no email → skipped
      ],
    });
    expect(e?.joinUrl).toBe('https://meet.google.com/abc-defg-hij');
    expect(e?.attendees).toEqual([{ email: 'ana@x.com', name: 'Ana' }, { email: 'bob@x.com' }]);
  });

  it('falls back to conferenceData video entry point for joinUrl', () => {
    const e = normalizeGoogleEvent({
      id: 'x',
      start: { dateTime: '2026-06-01T10:00:00Z' },
      end: { dateTime: '2026-06-01T10:30:00Z' },
      conferenceData: {
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+1' },
          { entryPointType: 'video', uri: 'https://zoom.us/j/123' },
        ],
      },
    });
    expect(e?.joinUrl).toBe('https://zoom.us/j/123');
  });

  it('uses a placeholder title when summary is missing', () => {
    const e = normalizeGoogleEvent({
      id: 'x',
      start: { dateTime: '2026-06-01T10:00:00Z' },
      end: { dateTime: '2026-06-01T10:30:00Z' },
    });
    expect(e?.title).toBe('Untitled event');
  });
});
