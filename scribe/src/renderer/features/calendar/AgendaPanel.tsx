import { useMemo } from 'react';
import type { AgendaEvent, CalendarProviderId } from '../../../shared/types';
import { Button } from '@/components/ui/button';

// Today's / upcoming agenda shown above the meeting list (ROADMAP_06). Each row
// is labelled by source and carries an "arm auto-start" toggle. The join link is
// metadata only — never clickable-to-join (CLAUDE.md §1.4). Renders nothing when
// there's no upcoming event so disconnected users see the normal sidebar.

const WINDOW_MS = 24 * 60 * 60 * 1000;

const SOURCE_LABEL: Record<CalendarProviderId, string> = {
  google: 'Google',
  microsoft: 'Outlook',
};

function formatWhen(e: AgendaEvent): string {
  if (e.allDay) return 'All day';
  return new Date(e.startMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

type AgendaPanelProps = {
  events: AgendaEvent[];
  onArm: (providerId: CalendarProviderId, externalId: string, armed: boolean) => void;
  onSelectMeeting: (meetingId: number) => void;
};

export function AgendaPanel({ events, onArm, onSelectMeeting }: AgendaPanelProps) {
  const upcoming = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => e.endMs > now && e.startMs < now + WINDOW_MS);
  }, [events]);

  if (upcoming.length === 0) return null;

  return (
    <div className="border-b border-border p-3">
      <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Upcoming
      </h3>
      <ul className="space-y-1">
        {upcoming.map((e) => (
          <li
            key={`${e.providerId}:${e.externalId}`}
            className="rounded-md border border-border bg-background px-2.5 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-foreground">{e.title || 'Busy'}</span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                {SOURCE_LABEL[e.providerId]}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {formatWhen(e)}
                {e.joinUrl && <span className="ml-1.5 text-muted-foreground">· has link</span>}
              </span>
              {e.meetingId !== null ? (
                <Button
                  variant="link"
                  size="xs"
                  className="h-auto p-0 text-[10px]"
                  onClick={() => onSelectMeeting(e.meetingId as number)}
                >
                  Open note
                </Button>
              ) : e.allDay ? (
                <span className="text-[10px] text-muted-foreground">—</span>
              ) : (
                <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={e.armed}
                    onChange={(ev) => onArm(e.providerId, e.externalId, ev.target.checked)}
                    className="h-3 w-3 accent-primary"
                  />
                  Auto-start
                </label>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
