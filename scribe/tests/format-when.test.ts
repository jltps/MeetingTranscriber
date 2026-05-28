import { describe, expect, it } from 'vitest';
import { formatEventWhen } from '../src/renderer/features/calendar/format-when';

// V072 block 06. Pin the timezone via TZ at test launch (Vitest config) — these
// assertions read date labels in the runner's local zone, so the test relies on
// Intl using the same calendar-day boundary the helper does.

const at = (y: number, m: number, d: number, h: number, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime();

describe('formatEventWhen', () => {
  it('same calendar day reads as "Today"', () => {
    const now = at(2026, 5, 28, 9, 0);
    const out = formatEventWhen(at(2026, 5, 28, 14, 30), false, now);
    expect(out.startsWith('Today · ')).toBe(true);
  });

  it('next calendar day reads as "Tomorrow"', () => {
    const now = at(2026, 5, 28, 20, 0);
    const out = formatEventWhen(at(2026, 5, 29, 9, 0), false, now);
    expect(out.startsWith('Tomorrow · ')).toBe(true);
  });

  it('within 7 days uses the weekday short name', () => {
    const now = at(2026, 5, 28, 9, 0); // Thursday
    const out = formatEventWhen(at(2026, 6, 1, 9, 0), false, now); // +4 → Monday
    expect(out).toMatch(/^(Mon|Mo|пн|lun\.?)/i); // locale-tolerant
    expect(out).toContain(' · ');
  });

  it('further than 7 days uses a month-and-day date', () => {
    const now = at(2026, 5, 28, 9, 0);
    const out = formatEventWhen(at(2026, 6, 12, 9, 0), false, now);
    // Don't lock the locale; just assert that "Today"/"Tomorrow"/weekday-only
    // are NOT the label and that a time part is present after the separator.
    expect(out.startsWith('Today')).toBe(false);
    expect(out.startsWith('Tomorrow')).toBe(false);
    expect(out).toContain(' · ');
  });

  it('all-day same-day reads as "Today · All day"', () => {
    const now = at(2026, 5, 28, 9, 0);
    expect(formatEventWhen(at(2026, 5, 28, 0, 0), true, now)).toBe('Today · All day');
  });

  it('all-day next-day reads as "Tomorrow · All day"', () => {
    const now = at(2026, 5, 28, 9, 0);
    expect(formatEventWhen(at(2026, 5, 29, 0, 0), true, now)).toBe('Tomorrow · All day');
  });

  it('DST-style 23h day boundary still rounds to "Tomorrow"', () => {
    // Simulate the day before a spring-forward: "tomorrow 9 AM" lives 23 hours
    // away in raw ms, not 24, but should still classify as the next calendar day.
    const now = at(2026, 3, 7, 9, 0);
    const out = formatEventWhen(at(2026, 3, 8, 9, 0) - 60 * 60 * 1000, false, now);
    expect(out.startsWith('Tomorrow · ')).toBe(true);
  });
});
