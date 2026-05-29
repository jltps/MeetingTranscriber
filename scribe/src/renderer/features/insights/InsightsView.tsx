import React from 'react';
import type { InsightEntity, InsightUtterance, MeetingInsights } from '../../../shared/types';
import { EmptyState } from '../../components/EmptyState';
import { Sparkles } from 'lucide-react';
import { InsightsSummary } from './InsightsSummary';
import { entityUnderlineClass, SENTIMENT_GLYPH, sentimentClass } from './insight-style';

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Weave inline NER underlines into an utterance's text using native offsets. */
function renderText(text: string, entities: InsightEntity[]): React.ReactNode {
  const spans = entities
    .filter((e) => typeof e.start === 'number' && typeof e.end === 'number' && e.end > e.start)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  if (spans.length === 0) return text;
  const nodes: React.ReactNode[] = [];
  let pos = 0;
  for (const e of spans) {
    const start = e.start as number;
    const end = e.end as number;
    if (start < pos) continue; // overlap — skip
    if (start > pos) nodes.push(text.slice(pos, start));
    nodes.push(
      <span key={`e-${start}`} className={entityUnderlineClass(e.kind)} title={e.kind}>
        {text.slice(start, end)}
      </span>,
    );
    pos = end;
  }
  if (pos < text.length) nodes.push(text.slice(pos));
  return nodes;
}

function Utterance({
  u,
  displayLabel,
}: {
  u: InsightUtterance;
  displayLabel: string;
}) {
  return (
    <div className="rounded px-1">
      <span
        className={`mr-2 text-xs font-semibold ${u.isMe ? 'text-speaker-self' : 'text-speaker-other'}`}
      >
        {displayLabel}
      </span>
      <span className="mr-2 text-[11px] tabular-nums text-muted-foreground">
        {formatTime(u.startMs)}
      </span>
      {u.sentiment && (
        <span
          className={`mr-2 text-xs ${sentimentClass(u.sentiment.label)}`}
          title={u.sentiment.emotion ? `${u.sentiment.label} · ${u.sentiment.emotion}` : u.sentiment.label}
        >
          {SENTIMENT_GLYPH[u.sentiment.label]}
        </span>
      )}
      <span className="text-sm leading-relaxed text-foreground">{renderText(u.text, u.entities)}</span>
    </div>
  );
}

/**
 * Dedicated post-call Insights view (V08, Gladia). Renders the enriched
 * transcript from Gladia's own utterances (entity offsets native to each
 * utterance's text) plus a summary card. Handles the processing/error/empty
 * states so the parent can mount it whenever insights exist or are in flight.
 */
export function InsightsView({
  insights,
  speakerNames,
}: {
  insights: MeetingInsights | null;
  speakerNames: Map<string, string>;
}) {
  if (!insights) return null;

  if (insights.status === 'processing') {
    return (
      <EmptyState
        icon={Sparkles}
        title="Analysing…"
        description="Gladia is producing diarization, named entities, and sentiment. This appears here as soon as it finishes."
      />
    );
  }
  if (insights.status === 'error') {
    return (
      <EmptyState
        icon={Sparkles}
        title="Insights unavailable"
        description={insights.error ?? 'Gladia could not produce post-call insights for this meeting.'}
      />
    );
  }
  if (insights.utterances.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No insights"
        description="No enriched utterances were produced for this meeting."
      />
    );
  }

  return (
    <div className="space-y-4">
      <InsightsSummary summary={insights.summary} speakerNames={speakerNames} />
      <div className="space-y-2">
        {insights.utterances.map((u, i) => (
          <Utterance
            key={`${u.startMs}-${i}`}
            u={u}
            displayLabel={speakerNames.get(u.speakerLabel) ?? u.speakerLabel}
          />
        ))}
      </div>
    </div>
  );
}
