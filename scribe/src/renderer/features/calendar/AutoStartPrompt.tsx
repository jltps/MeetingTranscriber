import { useEffect, useState } from 'react';
import type { AgendaEvent } from '../../../shared/types';

// Confirm/countdown prompt shown when an armed meeting reaches its start time
// (ROADMAP_06). We err toward asking rather than surprising the user with live
// capture: if the countdown elapses with no response we DISMISS (capture nothing),
// per the roadmap's guidance. Starting requires an explicit click.

const COUNTDOWN_SECONDS = 20;

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

type AutoStartPromptProps = {
  event: AgendaEvent;
  onStart: () => void;
  onDismiss: () => void;
};

export function AutoStartPrompt({ event, onStart, onDismiss }: AutoStartPromptProps) {
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    setRemaining(COUNTDOWN_SECONDS);
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          onDismiss(); // no response → do not start capture
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [event.externalId, onDismiss]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg border border-input bg-card p-5 shadow-xl">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          Meeting starting
        </div>
        <h2 className="mt-3 truncate text-base font-medium text-foreground">{event.title || 'Calendar event'}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatTime(event.startMs)} · from your calendar
        </p>
        <p className="mt-4 text-sm text-muted-foreground">Start recording this meeting now?</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-input px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onStart}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Start recording ({remaining}s)
          </button>
        </div>
      </div>
    </div>
  );
}
