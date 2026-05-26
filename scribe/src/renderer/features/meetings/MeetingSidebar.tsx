import { useState } from 'react';
import type { ReactNode } from 'react';
import type { MeetingStatus, MeetingSummary, Template } from '../../../shared/types';
import { useDebouncedCallback } from '../../lib/debounce';

function statusDot(status: MeetingStatus): string {
  if (status === 'transcribing') return 'bg-red-500 animate-pulse';
  if (status === 'ended') return 'bg-emerald-500';
  return 'bg-neutral-600';
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type MeetingSidebarProps = {
  meetings: MeetingSummary[];
  templates: Template[];
  selectedId: number | null;
  searching: boolean;
  disabled: boolean; // selection locked while recording
  onSelect: (id: number) => void;
  onNew: () => void;
  onSearch: (query: string) => void;
  onDelete: (id: number) => void;
  onOpenSettings: () => void;
  /** Optional content rendered above the meeting list (e.g. the calendar agenda). */
  agendaSlot?: ReactNode;
};

export function MeetingSidebar({
  meetings,
  templates,
  selectedId,
  searching,
  disabled,
  onSelect,
  onNew,
  onSearch,
  onDelete,
  onOpenSettings,
  agendaSlot,
}: MeetingSidebarProps) {
  const [text, setText] = useState('');
  const debouncedSearch = useDebouncedCallback(onSearch, 250);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <span className="text-sm font-semibold tracking-wide">Scribe</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            ⚙
          </button>
          <button
            type="button"
            onClick={onNew}
            className="rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
          >
            New Note
          </button>
        </div>
      </div>

      <div className="border-b border-neutral-800 p-3">
        <input
          type="search"
          value={text}
          placeholder="Search notes & transcripts"
          onChange={(e) => {
            setText(e.target.value);
            debouncedSearch(e.target.value);
          }}
          className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />
      </div>

      {agendaSlot}

      <div className="flex-1 overflow-y-auto">
        {meetings.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-neutral-500">
            {searching ? 'No matches' : 'No meetings yet'}
          </p>
        ) : (
          <ul>
            {meetings.map((m) => (
              <li
                key={m.id}
                className={`group flex items-stretch border-b border-neutral-800/60 ${
                  m.id === selectedId ? 'bg-neutral-800' : 'hover:bg-neutral-800/50'
                }`}
              >
                <button
                  type="button"
                  data-meeting-item={m.id}
                  disabled={disabled}
                  onClick={() => onSelect(m.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(m.status)}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-neutral-200">{m.title}</span>
                    <span className="block text-[11px] text-neutral-500">
                      {formatWhen(m.createdAt)}
                    </span>
                    {m.templateId && (() => {
                      const templateName = templates.find((t) => t.id === m.templateId)?.name;
                      return templateName ? (
                        <span className="mt-0.5 block truncate text-[10px] text-neutral-600">
                          {templateName}
                        </span>
                      ) : null;
                    })()}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Delete meeting"
                  disabled={disabled}
                  onClick={() => onDelete(m.id)}
                  className="hidden shrink-0 px-3 text-neutral-500 hover:text-red-400 disabled:opacity-50 group-hover:block"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
