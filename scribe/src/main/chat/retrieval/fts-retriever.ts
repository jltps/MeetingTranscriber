import { getEnhancerSegments, getMeeting, listMeetings, searchMeetings } from '../../db/meetings';
import { getSpeakerNames } from '../../db/speakers';
import type { Retriever, RetrievalScope, RetrievedSegment } from './retriever';
import { rankSegments } from './scorer';

// How many candidate meetings to consider in 'all' mode before segment ranking.
// Bounds work; the per-segment rank then trims to the LLM-context limit.
const MEETING_SHORTLIST_K = 12;

// FTS shortlist + in-memory segment ranking (ROADMAP_07 Phase 2). Uses only
// existing DB accessors — no migration, no new search-index to keep in sync.
export class FtsRetriever implements Retriever {
  retrieve(query: string, scope: RetrievalScope, limit: number): RetrievedSegment[] {
    const meetingIds = shortlistMeetings(query, scope);
    const all: RetrievedSegment[] = [];
    for (const meetingId of meetingIds) {
      const meeting = getMeeting(meetingId);
      if (!meeting) continue;
      // Resolve speaker labels to display names per meeting (ROADMAP_02) so the
      // grounded context reads "Ana: …" instead of "Speaker 1: …".
      const names = getSpeakerNames(meetingId);
      const nameMap = new Map(names.map((n) => [n.rawLabel, n.displayName]));
      for (const s of getEnhancerSegments(meetingId)) {
        all.push({
          ...s,
          speakerLabel: nameMap.get(s.speakerLabel) ?? s.speakerLabel,
          meetingId,
          meetingTitle: meeting.title,
        });
      }
    }
    return rankSegments(all, query, limit);
  }
}

// 'meetings' mode honours the explicit selection. 'all' mode uses FTS to rank
// relevant meetings, falling back to recent meetings when the query has no usable
// terms (e.g. "summarize everything"), so retrieval still has something to rank.
function shortlistMeetings(query: string, scope: RetrievalScope): number[] {
  if (scope.mode === 'meetings') return scope.meetingIds;
  const matched = searchMeetings(query).map((m) => m.id);
  if (matched.length > 0) return matched.slice(0, MEETING_SHORTLIST_K);
  return listMeetings()
    .slice(0, MEETING_SHORTLIST_K)
    .map((m) => m.id);
}
