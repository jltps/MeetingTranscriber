import { useCallback, useEffect, useState } from 'react';
import type { AgendaEvent, CalendarProviderId } from '../../../shared/types';

export type CalendarController = {
  /** Merged upcoming agenda across connected providers, pushed live from main. */
  agenda: AgendaEvent[];
  /** Opt an event in/out of auto-start. The agenda updates via the push. */
  armEvent: (providerId: CalendarProviderId, externalId: string, armed: boolean) => void;
  /** Force a re-sync now. */
  refresh: () => void;
};

// Subscribes to the merged agenda the main process pushes (sync/arm/connect),
// and exposes the arm toggle. Connect/disconnect live in Settings and talk to
// window.api.calendar directly. Mirrors use-transcription's subscribe pattern.
export function useCalendar(): CalendarController {
  const [agenda, setAgenda] = useState<AgendaEvent[]>([]);

  useEffect(() => {
    void window.api.calendar.getAgenda().then(setAgenda);
    return window.api.calendar.onAgenda(setAgenda);
  }, []);

  const armEvent = useCallback(
    (providerId: CalendarProviderId, externalId: string, armed: boolean): void => {
      void window.api.calendar.armEvent(providerId, externalId, armed);
    },
    [],
  );

  const refresh = useCallback((): void => {
    void window.api.calendar.refresh();
  }, []);

  return { agenda, armEvent, refresh };
}
