import { getGladiaKey } from '../secrets/api-keys';
import { getPendingInsights, saveInsights, setInsightsError } from '../db/insights';
import { getTranscript } from '../db/meetings';
import { fetchGladiaResults } from './gladia-results';
import { reconcileInsights } from './insights-reconcile';
import type { ProviderInsights } from './parse-gladia';
import { logger } from '../logger';

// V08 — at boot, finish any insights left `processing` because the app closed
// during Gladia's post-processing window. Best-effort + detached: never blocks
// startup. Without a Gladia key we leave the row processing (re-tried next boot
// once a key is set). A 404 / missing session marks the row errored.
export async function resumePendingInsights(): Promise<void> {
  const pending = getPendingInsights().filter((p) => p.provider === 'gladia');
  if (pending.length === 0) return;
  const key = getGladiaKey();
  if (!key) return;

  for (const p of pending) {
    if (p.sessionIds.length === 0) {
      setInsightsError(p.meetingId, 'No Gladia session id stored to resume.');
      continue;
    }
    try {
      const merged: ProviderInsights['utterances'] = [];
      for (const id of p.sessionIds) {
        const part = await fetchGladiaResults(id, key);
        merged.push(...part.utterances);
      }
      merged.sort((a, b) => a.startMs - b.startMs);
      const normalized = reconcileInsights({ utterances: merged }, getTranscript(p.meetingId));
      saveInsights(p.meetingId, normalized, p.sessionIds);
      logger.info('resumed gladia insights', `meeting=${p.meetingId}`);
    } catch (e) {
      setInsightsError(p.meetingId, e instanceof Error ? e.message : String(e));
    }
  }
}
