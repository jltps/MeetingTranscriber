# ROADMAP_06 — Calendar Integration (Google + Microsoft/Teams)

Connect a calendar so meetings can auto-start, matching how Granola behaves.
Support **both Google Calendar and Microsoft (Outlook / Teams) calendars** behind
one provider interface.

## Important scoping note (read first)
"Teams" here means the user's **Microsoft 365 / Outlook calendar**, read via the
**Microsoft Graph API** — that is where Teams meetings live as calendar events. It
does **not** mean integrating with the Teams call/SDK, and it does **not** change
the core promise: the app still **never joins the call** and still captures device
audio (system + mic) exactly as it does today. Calendar is only a *trigger and a
source of metadata* (title, time, attendees, join link), never a capture path.

## Why
Removes the main friction in the current flow (remembering to hit New Note +
Start). Most target users live in either Google Workspace or Microsoft 365, so
covering both is what makes auto-start actually useful day to day. Self-contained;
touches little else.

## Depends on
Shipped v1. Independent of other blocks. (Later feeds attendee names into block 02
speaker-naming suggestions.)

## Scope
- **One calendar-provider interface, two implementations:**
  - **Google Calendar** via the Google Calendar API.
  - **Microsoft (Outlook/Teams)** via the Microsoft Graph API (`/me/events` /
    calendar view).
  Both read-only. The rest of the app talks to the interface, not to either vendor.
- The user can connect **either or both**; show a unified merged agenda.
- Show today's / upcoming meetings in the app, each tagged with its source and, if
  present, its meeting type (Google Meet / Teams / Zoom link is just metadata).
- When the user has "clicked into" an upcoming meeting, **auto-start transcription
  at its scheduled time**. Never transcribe unless the user opted into that
  meeting; never start capture silently in the background.
- Pre-create the meeting note with title/attendees from the calendar event.
- Non-calendar calls keep the existing manual "New Note / Quick Note" path.

## Provider interface (indicative — adapt to the real code)
```ts
interface CalendarProvider {
  id: 'google' | 'microsoft';
  connect(): Promise<void>;                 // user-completed OAuth
  disconnect(): Promise<void>;
  isConnected(): boolean;
  listUpcoming(opts: { from: Date; to: Date }): Promise<CalendarEvent[]>;
}

type CalendarEvent = {
  providerId: 'google' | 'microsoft';
  externalId: string;
  title: string;
  start: Date;
  end: Date;
  attendees: { name?: string; email: string }[];
  joinUrl?: string;        // Teams/Meet/Zoom link if any — metadata only
};
```
The agenda UI and auto-start logic consume `CalendarEvent`s and are
provider-agnostic.

## Key decisions & caveats
- **Auth is OAuth, user-completed.** Per the operating rules, the user completes
  each provider's OAuth login themselves; the app never creates accounts or stores
  passwords. Request the **minimum read-only** calendar scope for each:
  - Google: a read-only calendar scope (e.g. `calendar.readonly` / events.readonly).
  - Microsoft Graph: a read-only calendar scope (e.g. `Calendars.Read`).
  Verify the current, least-privilege scope names in each vendor's docs at build
  time — they change.
- **Two separate app registrations.** Google (Cloud console OAuth client) and
  Microsoft (Entra ID / Azure app registration) are independent setups, each with
  its own client config and consent screen. Budget for both.
- **Token storage.** Store OAuth tokens via the same `safeStorage`-protected
  mechanism used for API keys; never plaintext, never logged, never in exports.
- **Privacy.** Calendar data (titles, attendees) is sensitive. Store only what's
  needed for the agenda + note pre-fill, keep it local, and honor the same
  no-leak posture as the rest of the app.
- **Auto-start must be unambiguous and visible** (the v1 recording indicator) and
  easy to cancel. Err toward asking rather than surprising the user with live
  capture.
- **Sharp edges to budget for:** time zones, recurring events, all-day events,
  declined/cancelled events, and overlapping meetings. Both APIs express these
  differently — normalize them in each provider implementation so the rest of the
  app sees one clean shape.

## Touches
Two calendar providers + their OAuth flows (main process), token storage, a unified
agenda UI, the meeting-start logic, mapping events → meeting notes. Nothing in the
audio/transcription path changes.

## Acceptance
- User can connect **Google**, **Microsoft (Teams/Outlook)**, or both, each via an
  OAuth flow they complete themselves.
- A merged upcoming-meetings agenda shows events from connected providers, each
  labeled by source.
- Opting into a meeting auto-starts transcription at its scheduled time with the
  indicator on; the note is pre-filled with title/attendees.
- Declining/closing a meeting captures nothing.
- Disconnecting a provider removes its events and revokes/clears its stored tokens.

## Out of scope
Joining or integrating with the Teams/Meet/Zoom call itself (we never join).
Writing to either calendar. Bots/invites. Reading email or other Graph/Google data
beyond calendar.
