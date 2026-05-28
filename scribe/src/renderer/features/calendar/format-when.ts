// Pure date/time formatting for agenda rows (V072 block 06). Extracted so it can
// be unit-tested without spinning React.

/** Calendar-day difference (in local time) between two timestamps. */
function dayDelta(startMs: number, nowMs: number): number {
  const a = new Date(startMs);
  const b = new Date(nowMs);
  const aDay = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bDay = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  // 86_400_000 is the average ms in a day; rounding absorbs the ±1 hour error
  // around DST boundaries so "tomorrow at 9 AM" still reads as +1 even when the
  // raw ms diff is 23 h or 25 h.
  return Math.round((aDay - bDay) / 86_400_000);
}

/** "Today" / "Tomorrow" / weekday-short / "Jun 4" depending on distance. */
function dateLabel(startMs: number, nowMs: number): string {
  const delta = dayDelta(startMs, nowMs);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  const date = new Date(startMs);
  if (delta > 1 && delta < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

/**
 * Compose the agenda row's date · time label, e.g. "Today · 2:34 PM" or
 * "Wed · All day". `now` is taken as an argument so tests can pin the clock.
 */
export function formatEventWhen(startMs: number, allDay: boolean, now: number): string {
  const date = dateLabel(startMs, now);
  if (allDay) return `${date} · All day`;
  const time = new Date(startMs).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date} · ${time}`;
}
