import { useCallback, useEffect, useState } from 'react';
import type { MeetingSummary } from '../../../shared/types';

export type MeetingsController = {
  meetings: MeetingSummary[];
  results: MeetingSummary[] | null; // non-null while a search is active
  query: string;
  refresh: () => Promise<void>;
  create: () => Promise<MeetingSummary>;
  remove: (id: number) => Promise<void>;
  search: (query: string) => Promise<void>;
};

// Owns the sidebar's meeting list and FTS search. `results` is null when not
// searching, so the UI shows the full list; otherwise it shows matches.
export function useMeetings(): MeetingsController {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [results, setResults] = useState<MeetingSummary[] | null>(null);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    setMeetings(await window.api.meetings.list());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    const meeting = await window.api.meetings.create();
    await refresh();
    return meeting;
  }, [refresh]);

  const remove = useCallback(
    async (id: number) => {
      await window.api.meetings.remove(id);
      await refresh();
    },
    [refresh],
  );

  const search = useCallback(async (next: string) => {
    setQuery(next);
    if (next.trim()) setResults(await window.api.meetings.search(next));
    else setResults(null);
  }, []);

  return { meetings, results, query, refresh, create, remove, search };
}
