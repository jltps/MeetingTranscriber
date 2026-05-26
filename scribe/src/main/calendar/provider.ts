import type { CalendarEvent, CalendarProviderId } from '../../shared/types';

// The swappable calendar-provider interface (ROADMAP_06). The rest of the app —
// the sync service, agenda, and auto-start — talks only to this, never to Google
// or Microsoft directly (CLAUDE.md §5). Mirrors transcription/session.ts.
//
// All implementations are READ-ONLY and never join a call: events are metadata
// only (CLAUDE.md §1.4).
export interface CalendarProvider {
  readonly id: CalendarProviderId;
  /** True when we hold credentials to fetch events (a stored refresh token). */
  isConnected(): boolean;
  /** Runs the user-completed OAuth flow in the system browser; stores tokens. */
  connect(): Promise<void>;
  /** Revokes the grant and clears stored tokens. */
  disconnect(): Promise<void>;
  /** Fetch expanded, normalized events in [fromMs, toMs]. */
  listUpcoming(opts: { fromMs: number; toMs: number }): Promise<CalendarEvent[]>;
}
