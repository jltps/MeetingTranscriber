import { useEffect, useRef } from 'react';
import type { AgendaEvent } from '../../../shared/types';

// Renderer-side auto-start scheduler (ROADMAP_06). The renderer owns this because
// audio capture is renderer-side — the main process must never start capture
// silently (CLAUDE.md §1). When an armed, timed event reaches its start time this
// fires `onDue`, which surfaces the confirm prompt. A rolling timeout targets the
// nearest event (so it fires close to the real start) and re-checks at least once
// a minute to survive clock drift across sleep/wake.

const MAX_DELAY_MS = 60_000;

export function useAutoStartScheduler(
  agenda: AgendaEvent[],
  onDue: (event: AgendaEvent) => void,
): void {
  // Events already handled this session — never prompt twice for the same one.
  const firedRef = useRef<Set<string>>(new Set());
  const onDueRef = useRef(onDue);
  onDueRef.current = onDue;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const tick = (): void => {
      const now = Date.now();
      let nextDelay = MAX_DELAY_MS;

      for (const e of agenda) {
        // Skip un-armed, all-day, and events already linked to a meeting.
        if (!e.armed || e.allDay || e.meetingId !== null) continue;
        const key = `${e.providerId}:${e.externalId}`;
        if (firedRef.current.has(key)) continue;

        if (now >= e.startMs && now < e.endMs) {
          firedRef.current.add(key);
          onDueRef.current(e);
        } else if (e.startMs > now) {
          nextDelay = Math.min(nextDelay, e.startMs - now);
        }
      }

      timer = setTimeout(tick, Math.max(1_000, Math.min(nextDelay, MAX_DELAY_MS)));
    };

    tick();
    return () => clearTimeout(timer);
  }, [agenda]);
}
