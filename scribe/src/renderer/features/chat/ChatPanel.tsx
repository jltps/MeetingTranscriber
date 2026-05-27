import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import type { ChatController, ChatTurn } from './use-chat';
import { MarkdownMessage } from './MarkdownMessage';
import { EmptyState } from '../../components/EmptyState';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// A grounded, Markdown-formatted answer whose [id=N] markers render as chips that flash
// the cited transcript line (reuses TranscriptPanel's existing highlight via onCiteClick).
function AssistantText({
  turn,
  onCiteClick,
}: {
  turn: ChatTurn;
  onCiteClick: (segmentId: number) => void;
}) {
  const cited = new Set(turn.citationIds ?? []);
  return (
    <MarkdownMessage
      content={turn.content}
      renderCite={(segmentId, key) => (
        <button
          key={key}
          type="button"
          // Only validated ids are clickable; a hallucinated id is shown inert.
          onClick={cited.has(segmentId) ? () => onCiteClick(segmentId) : undefined}
          disabled={!cited.has(segmentId)}
          title={cited.has(segmentId) ? 'Jump to transcript' : undefined}
          className={`mx-0.5 inline-flex items-center rounded px-1 text-[11px] font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            cited.has(segmentId)
              ? 'cursor-pointer bg-info/20 text-info hover:bg-info/30'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          #{segmentId}
        </button>
      )}
    />
  );
}

export function ChatPanel({
  controller,
  onCiteClick,
  available,
  keyMissing = false,
  onConnectKeys,
}: {
  controller: ChatController;
  onCiteClick: (segmentId: number) => void;
  /** Whether the meeting has a transcript to chat about. */
  available: boolean;
  /** True when the Anthropic key isn't set (chat needs it). */
  keyMissing?: boolean;
  onConnectKeys?: () => void;
}) {
  const { messages, streamingText, busy, error, ask } = controller;
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest message / streamed tokens in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  const submit = (): void => {
    if (!input.trim() || busy || !available) return;
    ask(input);
    setInput('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Ask this meeting</div>
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-atomic="false"
        className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-card p-4"
      >
        {!available ? (
          <EmptyState
            icon={MessageSquare}
            title="Chat needs a transcript"
            description="Record this meeting or open an ended one, then ask questions grounded in what was said."
          />
        ) : messages.length === 0 && !busy ? (
          <EmptyState
            icon={MessageSquare}
            title="Ask this meeting"
            description={'e.g. “What did we decide?” or “List the action items.” Answers cite the transcript lines they came from.'}
            action={
              keyMissing && onConnectKeys
                ? { label: 'Connect API keys', onClick: onConnectKeys }
                : undefined
            }
          />
        ) : (
          <>
            {messages.map((turn, i) =>
              turn.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">
                    {turn.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="max-w-[95%]">
                  <AssistantText turn={turn} onCiteClick={onCiteClick} />
                </div>
              ),
            )}
            {busy && (
              <div className="max-w-[95%]">
                {streamingText ? (
                  <>
                    <MarkdownMessage content={streamingText} renderCite={(id, key) => <span key={key}>[id={id}]</span>} />
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground align-middle" />
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">Thinking…</span>
                )}
              </div>
            )}
          </>
        )}
        {error && (
          <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          disabled={!available || busy}
          placeholder={available ? 'Ask about this meeting…' : 'No transcript yet'}
          className="min-h-0 flex-1 resize-none"
        />
        <Button
          size="icon"
          onClick={submit}
          disabled={!available || busy || !input.trim()}
          aria-label="Send"
        >
          <Send />
        </Button>
      </div>
    </div>
  );
}
