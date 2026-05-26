# ROADMAP_06 — Calendar Integration

Connect a calendar so meetings can auto-start, matching how Granola behaves.

## Why
Removes the main friction in the current flow (remembering to hit New Note + Start).
Self-contained; touches little else.

## Depends on
Shipped v1. Independent of other blocks.

## Scope
- Read-only connection to Google Calendar first (add others later).
- Show today's/upcoming meetings in the app.
- When the user has "clicked into" an upcoming meeting, **auto-start transcription
  at its scheduled time**. Do not transcribe unless the user has opted into that
  meeting; never start capture silently in the background.
- Pre-create the meeting note with title/attendees from the calendar event.
- Non-calendar calls keep the existing manual "New Note / Quick Note" path.

## Key decisions & caveats
- **Auth is OAuth.** Per the operating rules, the user completes the OAuth login
  themselves; the app does not create accounts or store passwords. Request the
  minimum read-only scope.
- Calendar data (titles, attendees) can be sensitive; store only what is needed and
  keep it local under the same privacy posture.
- Auto-start must be unambiguous and visible (the recording indicator from v1), and
  easy to cancel. Err toward asking rather than surprising the user with live
  capture.
- Time-zone and recurring-event handling are the usual sharp edges; budget for them.

## Touches
A calendar provider + OAuth flow (main process), a calendar/agenda UI, the
meeting-start logic, mapping events → meeting notes.

## Acceptance
- User connects Google Calendar via OAuth they complete themselves.
- Upcoming meetings show in-app; opting into one auto-starts transcription at the
  scheduled time with the indicator on.
- Declining/closing it does not capture anything.

## Out of scope
Auto-joining calls (we never join). Writing to the calendar. Bots/invites.
