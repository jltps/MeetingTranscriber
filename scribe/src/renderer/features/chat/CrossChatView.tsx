import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, MessagesSquare, Send } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import type { Folder, MeetingSummary, RetrievalScope, Tag } from '../../../shared/types';
import { estimateCost, formatCost } from '../../../shared/pricing';
import { useDebouncedCallback } from '../../lib/debounce';
import type { CrossChatController, CrossChatTurn } from './use-cross-chat';
import { MarkdownMessage } from './MarkdownMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { flattenFolders } from '../organization/use-organization';

const ANY = 'any';

function abbreviate(title: string): string {
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
}

// A grounded cross-meeting answer with [id=N] markers rendered as chips tagged
// with their source meeting; clicking one opens that meeting and flashes the line.
function AssistantText({
  turn,
  onCiteClick,
}: {
  turn: CrossChatTurn;
  onCiteClick: (meetingId: number, segmentId: number) => void;
}) {
  const byId = new Map((turn.citations ?? []).map((c) => [c.segmentId, c]));
  return (
    <MarkdownMessage
      content={turn.content}
      renderCite={(segmentId, key) => {
        const cite = byId.get(segmentId);
        return cite ? (
          <button
            key={key}
            type="button"
            onClick={() => onCiteClick(cite.meetingId, cite.segmentId)}
            title={`Jump to "${cite.meetingTitle}"`}
            className="mx-0.5 inline-flex items-center rounded bg-info/20 px-1 text-[11px] font-medium text-info outline-none hover:bg-info/30 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {abbreviate(cite.meetingTitle)} #{cite.segmentId}
          </button>
        ) : (
          // Hallucinated id (not in the retrieved set) — shown inert.
          <span
            key={key}
            className="mx-0.5 inline-flex items-center rounded bg-muted px-1 text-[11px] text-muted-foreground"
          >
            #{segmentId}
          </span>
        );
      }}
    />
  );
}

export function CrossChatView({
  controller,
  meetings,
  folders,
  tags,
  onCiteClick,
  onClose,
  keyMissing = false,
  onConnectKeys,
}: {
  controller: CrossChatController;
  /** Full meeting list, for the scope selector. */
  meetings: MeetingSummary[];
  folders: Folder[];
  tags: Tag[];
  onCiteClick: (meetingId: number, segmentId: number) => void;
  onClose: () => void;
  keyMissing?: boolean;
  onConnectKeys?: () => void;
}) {
  const { messages, streamingText, busy, error, ask } = controller;
  const [input, setInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [scopeFolderId, setScopeFolderId] = useState<number | null>(null);
  const [scopeTagId, setScopeTagId] = useState<number | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  // Content-search filter for the scope list (reuses meetings.search). null = full list.
  const [filtered, setFiltered] = useState<MeetingSummary[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const runFilter = useDebouncedCallback((text: string) => {
    if (text.trim()) void window.api.meetings.search(text).then(setFiltered);
    else setFiltered(null);
  }, 250);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  // Precedence: folder (incl. descendants) > tag > explicit meetings > all.
  const scope: RetrievalScope = useMemo(() => {
    if (scopeFolderId !== null) return { mode: 'folder', folderId: scopeFolderId };
    if (scopeTagId !== null) return { mode: 'tag', tagId: scopeTagId };
    if (selectedIds.size > 0) return { mode: 'meetings', meetingIds: [...selectedIds] };
    return { mode: 'all' };
  }, [scopeFolderId, scopeTagId, selectedIds]);

  const scopeLabel =
    scopeFolderId !== null
      ? `Asking across folder "${folders.find((f) => f.id === scopeFolderId)?.name ?? '?'}"`
      : scopeTagId !== null
        ? `Asking across tag "${tags.find((t) => t.id === scopeTagId)?.name ?? '?'}"`
        : selectedIds.size === 0
          ? `Asking across all ${meetings.length} meetings`
          : `Asking across ${selectedIds.size} selected`;

  const toggle = (id: number): void =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = (): void => {
    if (!input.trim() || busy) return;
    ask(input, scope);
    setInput('');
  };

  const scopeList = filtered ?? meetings;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <span className="text-base font-medium text-foreground">Ask across meetings</span>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      {/* Scope selector */}
      <div className="border-b border-border px-6 py-2">
        <button
          type="button"
          onClick={() => setScopeOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left text-xs text-muted-foreground hover:text-foreground"
        >
          <span>{scopeLabel}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            scope {scopeOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </span>
        </button>
        {scopeOpen && (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2">
              <Select
                value={scopeFolderId === null ? ANY : String(scopeFolderId)}
                onValueChange={(v) => {
                  setScopeFolderId(v === ANY ? null : Number(v));
                  if (v !== ANY) setScopeTagId(null);
                }}
              >
                <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
                  <SelectValue placeholder="Folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any folder</SelectItem>
                  {flattenFolders(folders).map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {' '.repeat(f.depth * 2)}
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={scopeTagId === null ? ANY : String(scopeTagId)}
                onValueChange={(v) => {
                  setScopeTagId(v === ANY ? null : Number(v));
                  if (v !== ANY) setScopeFolderId(null);
                }}
              >
                <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
                  <SelectValue placeholder="Tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any tag</SelectItem>
                  {tags.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <Input
                type="search"
                placeholder="Filter meetings by content…"
                disabled={scopeFolderId !== null || scopeTagId !== null}
                onChange={(e) => runFilter(e.target.value)}
                className="h-8 flex-1 text-xs"
              />
              {selectedIds.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear ({selectedIds.size})
                </Button>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border">
              {scopeList.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No meetings.</p>
              ) : (
                scopeList.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(m.id)}
                      onChange={() => toggle(m.id)}
                    />
                    <span className="truncate">{m.title}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Thread */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-atomic="false"
        className="flex-1 space-y-4 overflow-y-auto px-6 py-4"
      >
        {messages.length === 0 && !busy ? (
          <EmptyState
            icon={MessagesSquare}
            title="Ask across your meetings"
            description={'e.g. “What did we decide about pricing?” or “Summarize everything about Project X.” Answers cite the meeting + line they came from.'}
            action={
              keyMissing && onConnectKeys
                ? { label: 'Connect API keys', onClick: onConnectKeys }
                : undefined
            }
          />
        ) : (
          messages.map((turn, i) =>
            turn.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">
                  {turn.content}
                </div>
              </div>
            ) : (
              <div key={i} className="max-w-[95%]">
                <AssistantText turn={turn} onCiteClick={onCiteClick} />
                {turn.usage && (
                  <div className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                    ~{formatCost(estimateCost(0, turn.usage.inputTokens, turn.usage.outputTokens))} ·{' '}
                    {(turn.usage.inputTokens + turn.usage.outputTokens).toLocaleString()} tokens
                  </div>
                )}
              </div>
            ),
          )
        )}
        {busy && (
          <div className="max-w-[95%]">
            {streamingText ? (
              <>
                <MarkdownMessage content={streamingText} renderCite={(id, key) => <span key={key}>[id={id}]</span>} />
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground align-middle" />
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Searching meetings…</span>
            )}
          </div>
        )}
        {error && (
          <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-border px-6 py-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Ask across meetings…"
          className="min-h-0 flex-1 resize-none"
        />
        <Button size="icon" onClick={submit} disabled={busy || !input.trim()} aria-label="Send">
          <Send />
        </Button>
      </div>
    </div>
  );
}
