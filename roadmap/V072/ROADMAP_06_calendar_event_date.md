# ROADMAP_06 — Date on Calendar Events

## Problem

Each agenda row shows only the time
(`scribe/src/renderer/features/calendar/AgendaPanel.tsx:42–82`), e.g.
"02:34 PM", because the panel currently only renders events ending after
"now" and starting within a 24 h window. Even within that window, "is
this 2 PM today or 2 PM tomorrow?" is ambiguous when the user opens the
app in the late evening and sees a 9 AM event — without the date, they
guess.

If the agenda window is ever widened (a likely follow-up), the missing
date becomes worse: "Wed 02:34 PM" is unambiguous; "02:34 PM" is not.

## Goal

Every agenda row shows a human-readable date alongside the time:

- Today → "Today · 2:34 PM"
- Tomorrow → "Tomorrow · 9:00 AM"
- Within the next 7 days → "Wed · 9:00 AM"
- Further out → "Jun 4 · 9:00 AM" (or "4 Jun" per locale)
- All-day same-day → "Today · All day"
- All-day other day → "Wed · All day"

## Non-goals

- Widening the 24 h window (the `WINDOW_MS = 24h` rule stays as-is in
  V072; a wider window is a future block).
- Date grouping headers between events ("Today", "Tomorrow" as
  separators) — the date label per row covers it.
- Localised date formatting beyond what `Intl.DateTimeFormat` gives us
  for free.
- A timezone selector — use the system's local timezone (current
  behaviour).

## Approach

### Update `AgendaPanel.tsx`

Replace `formatWhen(e)` (which currently returns time only) with a new
helper `formatEventWhen(e, now)` that returns:

- For non-all-day events:
  `"{dateLabel} · {timeLabel}"` where
  - `timeLabel` = the existing `toLocaleTimeString({ hour: '2-digit',
    minute: '2-digit' })`.
  - `dateLabel` is computed from `e.startMs` vs `now`:
    - Same calendar day → `"Today"`.
    - Next calendar day → `"Tomorrow"`.
    - Within 7 days → weekday short name via
      `new Intl.DateTimeFormat(undefined, { weekday: 'short' })`.
    - Further → `new Intl.DateTimeFormat(undefined, { month: 'short',
      day: 'numeric' })`.
- For all-day events: `"{dateLabel} · All day"` (the existing all-day
  branch logic stays; the `"—"` placeholder on the right is unchanged).

Implementation note: do calendar-day comparison with the system local
zone, not via `Math.floor(ms / 86400000)` (which is UTC-day). Standard
`Date#toDateString()` comparison works.

The label still renders inside the existing structure (AgendaPanel.tsx
line 58):

```jsx
<span className="text-[11px] tabular-nums text-muted-foreground">
  {formatEventWhen(e, now)}
  {e.joinUrl && ' · has link'}
</span>
```

`tabular-nums` keeps times aligned column-wise across rows; the date
prefix is variable-width but short enough that alignment stays
acceptable. If it doesn't, drop `tabular-nums` for this label only — V04
visual norms don't require column alignment for agenda rows.

### `now` cache

The component currently re-renders on a timer (verify in
`AgendaPanel.tsx`). Use the existing render-time `Date.now()` as the
`now` argument to `formatEventWhen`; no new state needed.

### Unit-testable helper

Extract `formatEventWhen(startMs, allDay, now): string` into a pure
module (e.g. `scribe/src/renderer/features/calendar/format-when.ts`)
and unit-test it without spinning React. Cases to cover:

1. Same calendar day → "Today · 9:00 AM".
2. Next calendar day, evening now → "Tomorrow · 9:00 AM".
3. Within 7 days → "Wed · 9:00 AM" (mock locale to a known one).
4. Further → "Jun 4 · 9:00 AM".
5. All-day, today → "Today · All day".
6. All-day, in 3 days → "Sat · All day".
7. DST boundary: an event "tomorrow 9 AM" the day before spring-forward
   still reads "Tomorrow · 9:00 AM" (the calendar-day comparison must
   not rely on millisecond-equality arithmetic).

## Verification

### Visual

1. Open the app at 9 AM — today's 10 AM event reads
   "Today · 10:00 AM".
2. Open the app at 8 PM — tomorrow's 9 AM event reads
   "Tomorrow · 9:00 AM".
3. (Cannot trigger live; visual-inspect with mock data if needed.)
   Widen the window temporarily in dev (set `WINDOW_MS = 7 * 24 *
   3600 * 1000`) and confirm "Wed · 9:00 AM" formatting before
   reverting.
4. All-day event today renders "Today · All day".
5. Both themes — label still legible.

### Functional

- No change to which events render — `WINDOW_MS` unchanged.
- No change to auto-start behaviour or open-note behaviour.
- Existing source badge ("Google" / "Outlook") and join-url marker
  unchanged.

### Type/lint/test/build gates

All four green; new unit tests in
`scribe/src/renderer/features/calendar/__tests__/format-when.test.ts`
cover the cases above.

## §1 invariants — affirmation checklist

- **§1.1 – §1.7.** All unaffected — pure presentation change.

## Acceptance

- `formatEventWhen` helper extracted + unit-tested.
- AgendaPanel rows render "{dateLabel} · {timeLabel}" / "{dateLabel} ·
  All day".
- No regression in event rendering, auto-start, or open-note flows.
- One commit, directly to `main`, Conventional Commits
  (`feat(ui): show date alongside time on agenda rows`).
