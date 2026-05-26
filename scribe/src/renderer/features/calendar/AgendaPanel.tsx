import { useMemo } from 'react';
import type { AgendaEvent, CalendarProviderId } from '../../../shared/types';

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
    <div className="border-b border-neutral-800 p-3">
      <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Upcoming
      </h3>
      <ul className="space-y-1">
        {upcoming.map((e) => (
          <li
            key={`${e.providerId}:${e.externalId}`}
            className="rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-neutral-200">{e.title}</span>
              <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-400">
                {SOURCE_LABEL[e.providerId]}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[11px] tabular-nums text-neutral-500">
                {formatWhen(e)}
                {e.joinUrl && <span className="ml-1.5 text-neutral-600">· has link</span>}
              </span>
              {e.meetingId !== null ? (
                <button
                  type="button"
                  onClick={() => onSelectMeeting(e.meetingId as number)}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300"
                >
                  Open note
                </button>
              ) : e.allDay ? (
                <span className="text-[10px] text-neutral-600">—</span>
              ) : (
                <label className="flex cursor-pointer items-center gap-1 text-[10px] text-neutral-400">
                  <input
                    type="checkbox"
                    checked={e.armed}
                    onChange={(ev) => onArm(e.providerId, e.externalId, ev.target.checked)}
                    className="h-3 w-3 accent-emerald-400"
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
