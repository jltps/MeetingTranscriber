import { useEffect, useState } from 'react';
import { Mic } from 'lucide-react';
import type { AgendaEvent } from '../../../shared/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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

  // Escape / overlay click → dismiss (errs toward not recording, per ROADMAP_06).
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onDismiss(); }}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            Meeting starting
          </div>
          <DialogTitle className="mt-1 truncate">{event.title || 'Calendar event'}</DialogTitle>
          <DialogDescription>{formatTime(event.startMs)} · from your calendar</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Start recording this meeting now?</p>
        <DialogFooter>
          <Button variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
          <Button onClick={onStart}>
            <Mic />
            Start recording ({remaining}s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
