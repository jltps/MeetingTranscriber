import { useEffect, useRef, useState } from 'react';
import type { ChatController, ChatTurn } from './use-chat';
import { parseCitations } from './parse-citations';

// A grounded answer with its [id=N] markers rendered as chips that flash the cited
// transcript line (reuses TranscriptPanel's existing highlight via onCiteClick).
function AssistantText({
  turn,
  onCiteClick,
}: {
  turn: ChatTurn;
  onCiteClick: (segmentId: number) => void;
}) {
  const cited = new Set(turn.citationIds ?? []);
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">
      {parseCitations(turn.content).map((node, i) =>
        node.kind === 'text' ? (
          <span key={i}>{node.text}</span>
        ) : (
          <button
            key={i}
            type="button"
            // Only validated ids are clickable; a hallucinated id is shown inert.
            onClick={cited.has(node.segmentId) ? () => onCiteClick(node.segmentId) : undefined}
            disabled={!cited.has(node.segmentId)}
            title={cited.has(node.segmentId) ? 'Jump to transcript' : undefined}
            className={`mx-0.5 inline-flex items-center rounded px-1 text-[11px] font-medium tabular-nums ${
              cited.has(node.segmentId)
                ? 'cursor-pointer bg-sky-500/20 text-sky-300 hover:bg-sky-500/30'
                : 'bg-neutral-800 text-neutral-500'
            }`}
          >
            #{node.segmentId}
          </button>
        ),
      )}
    </div>
  );
}

export function ChatPanel({
  controller,
  onCiteClick,
  available,
}: {
  controller: ChatController;
  onCiteClick: (segmentId: number) => void;
  /** Whether the meeting has a transcript to chat about. */
  available: boolean;
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
      <div className="mb-3 text-xs uppercase tracking-wide text-neutral-500">Ask this meeting</div>
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4"
      >
        {!available ? (
          <p className="text-sm leading-relaxed text-neutral-600">
            Chat becomes available once this meeting has a transcript. Record or open an ended
            meeting, then ask questions grounded in what was said.
          </p>
        ) : messages.length === 0 && !busy ? (
          <p className="text-sm leading-relaxed text-neutral-600">
            Ask a question about this meeting — e.g. "What did we decide?" or "List the action
            items." Answers cite the transcript lines they came from.
          </p>
        ) : (
          <>
            {messages.map((turn, i) =>
              turn.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-neutral-700 px-3 py-2 text-sm text-neutral-100">
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
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">
                    {streamingText}
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-neutral-400 align-middle" />
                  </div>
                ) : (
                  <span className="text-sm text-neutral-500">Thinking…</span>
                )}
              </div>
            )}
          </>
        )}
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
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
          className="min-h-0 flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!available || busy || !input.trim()}
          className="rounded-md bg-emerald-400 px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-300 disabled:opacity-50"
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
