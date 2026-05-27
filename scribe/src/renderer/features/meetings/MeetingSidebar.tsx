import { useState } from 'react';
import type { ReactNode } from 'react';
import { MessageSquare, Plus, Search, Settings, X } from 'lucide-react';
import type { MeetingStatus, MeetingSummary, Template } from '../../../shared/types';
import { useDebouncedCallback } from '../../lib/debounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function statusDot(status: MeetingStatus): string {
  if (status === 'transcribing') return 'bg-destructive animate-pulse';
  if (status === 'ended') return 'bg-primary';
  return 'bg-muted-foreground';
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
  /** Open the cross-meeting chat view (ROADMAP_07 Phase 2). */
  onOpenCrossChat: () => void;
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
  onOpenCrossChat,
  agendaSlot,
}: MeetingSidebarProps) {
  const [text, setText] = useState('');
  const debouncedSearch = useDebouncedCallback(onSearch, 250);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold tracking-wide">Scribe</span>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} aria-label="Settings">
                <Settings />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <Button size="sm" onClick={onNew}>
            <Plus />
            New Note
          </Button>
        </div>
      </div>

      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={text}
            placeholder="Search notes & transcripts"
            onChange={(e) => {
              setText(e.target.value);
              debouncedSearch(e.target.value);
            }}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button variant="outline" size="sm" onClick={onOpenCrossChat} className="w-full">
          <MessageSquare />
          Ask across meetings
        </Button>
      </div>

      {agendaSlot}

      <div className="flex-1 overflow-y-auto">
        {meetings.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {searching ? 'No matches' : 'No meetings yet'}
          </p>
        ) : (
          <ul>
            {meetings.map((m) => (
              <li
                key={m.id}
                className={`group flex items-stretch border-b border-border/60 ${
                  m.id === selectedId ? 'bg-muted' : 'hover:bg-muted/50'
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
                    <span className="block truncate text-sm text-foreground">{m.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatWhen(m.createdAt)}
                    </span>
                    {m.templateId && (() => {
                      const templateName = templates.find((t) => t.id === m.templateId)?.name;
                      return templateName ? (
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {templateName}
                        </span>
                      ) : null;
                    })()}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete meeting"
                  disabled={disabled}
                  onClick={() => onDelete(m.id)}
                  className="mr-1 hidden self-center text-muted-foreground hover:text-destructive group-hover:inline-flex"
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
