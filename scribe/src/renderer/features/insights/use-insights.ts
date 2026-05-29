import { useEffect, useState } from 'react';
import type { MeetingInsights } from '../../../shared/types';

// V08: load a meeting's post-call Gladia insights and keep them fresh. The
// `transcription:insightsStatus` push is treated as advisory — on a matching
// meeting it triggers an authoritative re-fetch via `meetings.getInsights`, so a
// meeting opened in the background still flips from "Analysing…" to ready.
export type InsightsController = {
  insights: MeetingInsights | null;
  loading: boolean;
};

export function useInsights(meetingId: number | null): InsightsController {
  const [insights, setInsights] = useState<MeetingInsights | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (meetingId === null) {
      setInsights(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void window.api.meetings.getInsights(meetingId).then((res) => {
      if (cancelled) return;
      setInsights(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    if (meetingId === null) return;
    return window.api.onTranscriptionInsightsStatus((s) => {
      if (s.meetingId !== meetingId) return;
      void window.api.meetings.getInsights(meetingId).then(setInsights);
    });
  }, [meetingId]);

  return { insights, loading };
}
