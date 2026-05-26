/**
 * Calendar IPC contract tests (ROADMAP_06). Validates the new Zod schemas accept
 * valid payloads and reject malformed ones — the IPC boundary's first defense.
 */
import { describe, it, expect } from 'vitest';
import {
  AgendaEventSchema,
  CalendarArmSchema,
  CalendarEventSchema,
  CalendarLinkSchema,
  CalendarProviderIdSchema,
} from '../src/shared/ipc-contract';

const baseEvent = {
  providerId: 'google',
  externalId: 'evt1',
  title: 'Sync',
  startMs: 1_900_000_000_000,
  endMs: 1_900_000_900_000,
  allDay: false,
  attendees: [{ email: 'a@x.com', name: 'Ana' }, { email: 'b@x.com' }],
  joinUrl: 'https://meet.google.com/x',
};

describe('CalendarProviderIdSchema', () => {
  it('accepts google and microsoft', () => {
    expect(CalendarProviderIdSchema.parse('google')).toBe('google');
    expect(CalendarProviderIdSchema.parse('microsoft')).toBe('microsoft');
  });
  it('rejects unknown providers', () => {
    expect(() => CalendarProviderIdSchema.parse('apple')).toThrow();
  });
});

describe('CalendarEventSchema', () => {
  it('accepts a full event and one without optional fields', () => {
    expect(() => CalendarEventSchema.parse(baseEvent)).not.toThrow();
    const minimal = { ...baseEvent };
    delete (minimal as { joinUrl?: string }).joinUrl;
    expect(() => CalendarEventSchema.parse(minimal)).not.toThrow();
  });
  it('rejects non-integer times and bad provider', () => {
    expect(() => CalendarEventSchema.parse({ ...baseEvent, startMs: 1.5 })).toThrow();
    expect(() => CalendarEventSchema.parse({ ...baseEvent, providerId: 'nope' })).toThrow();
  });
});

describe('AgendaEventSchema', () => {
  it('accepts armed + nullable meetingId', () => {
    expect(() => AgendaEventSchema.parse({ ...baseEvent, armed: true, meetingId: null })).not.toThrow();
    expect(() => AgendaEventSchema.parse({ ...baseEvent, armed: false, meetingId: 7 })).not.toThrow();
  });
  it('rejects a non-positive meetingId', () => {
    expect(() => AgendaEventSchema.parse({ ...baseEvent, armed: false, meetingId: 0 })).toThrow();
  });
});

describe('CalendarArmSchema', () => {
  it('accepts a valid arm payload', () => {
    expect(CalendarArmSchema.parse({ providerId: 'google', externalId: 'e', armed: true })).toEqual({
      providerId: 'google',
      externalId: 'e',
      armed: true,
    });
  });
  it('rejects an empty externalId or missing armed', () => {
    expect(() => CalendarArmSchema.parse({ providerId: 'google', externalId: '', armed: true })).toThrow();
    expect(() => CalendarArmSchema.parse({ providerId: 'google', externalId: 'e' })).toThrow();
  });
});

describe('CalendarLinkSchema', () => {
  it('accepts a valid link payload', () => {
    expect(() =>
      CalendarLinkSchema.parse({ providerId: 'google', externalId: 'e', meetingId: 3 }),
    ).not.toThrow();
  });
  it('rejects a non-positive meetingId', () => {
    expect(() =>
      CalendarLinkSchema.parse({ providerId: 'google', externalId: 'e', meetingId: -1 }),
    ).toThrow();
  });
});
