import { useEffect, useMemo, useRef, useState } from 'react';
import type { MeetingSummary, RetrievalScope } from '../../../shared/types';
import { estimateCost, formatCost } from '../../../shared/pricing';
import { useDebouncedCallback } from '../../lib/debounce';
import type { CrossChatController, CrossChatTurn } from './use-cross-chat';
import { parseCitations } from './parse-citations';

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
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
      {parseCitations(turn.content).map((node, i) => {
        if (node.kind === 'text') return <span key={i}>{node.text}</span>;
        const cite = byId.get(node.segmentId);
        return cite ? (
          <button
            key={i}
            type="button"
            onClick={() => onCiteClick(cite.meetingId, cite.segmentId)}
            title={`Jump to "${cite.meetingTitle}"`}
            className="mx-0.5 inline-flex items-center rounded bg-info/20 px-1 text-[11px] font-medium text-info hover:bg-info/30"
          >
            {abbreviate(cite.meetingTitle)} #{cite.segmentId}
          </button>
        ) : (
          // Hallucinated id (not in the retrieved set) — shown inert.
          <span
            key={i}
            className="mx-0.5 inline-flex items-center rounded bg-muted px-1 text-[11px] text-muted-foreground"
          >
            #{node.segmentId}
          </span>
        );
      })}
    </div>
  );
}

export function CrossChatView({
  controller,
  meetings,
  onCiteClick,
  onClose,
}: {
  controller: CrossChatController;
  /** Full meeting list, for the scope selector. */
  meetings: MeetingSummary[];
  onCiteClick: (meetingId: number, segmentId: number) => void;
  onClose: () => void;
}) {
  const { messages, streamingText, busy, error, ask } = controller;
  const [input, setInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
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

  const scope: RetrievalScope = useMemo(
    () =>
      selectedIds.size === 0
        ? { mode: 'all' }
        : { mode: 'meetings', meetingIds: [...selectedIds] },
    [selectedIds],
  );

  const scopeLabel =
    selectedIds.size === 0
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
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          Close
        </button>
      </header>

      {/* Scope selector */}
      <div className="border-b border-border px-6 py-2">
        <button
          type="button"
          onClick={() => setScopeOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left text-xs text-muted-foreground hover:text-foreground"
        >
          <span>{scopeLabel}</span>
          <span className="text-muted-foreground">{scopeOpen ? '▴ scope' : '▾ scope'}</span>
        </button>
        {scopeOpen && (
          <div className="mt-2">
            <div className="mb-2 flex items-center gap-2">
              <input
                type="search"
                placeholder="Filter meetings by content…"
                onChange={(e) => runFilter(e.target.value)}
                className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-input focus:outline-none"
              />
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  Clear ({selectedIds.size})
                </button>
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
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !busy ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ask a question spanning your meetings — e.g. "What did we decide about pricing?" or
            "Summarize everything about Project X." Answers cite the meeting and transcript line
            they came from.
          </p>
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
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {streamingText}
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground align-middle" />
              </div>
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
        <textarea
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
          className="min-h-0 flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !input.trim()}
          className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
