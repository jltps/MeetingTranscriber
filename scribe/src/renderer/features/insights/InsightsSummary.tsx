import type { MeetingInsightsSummary } from '../../../shared/types';
import { entityTextClass, sentimentClass } from './insight-style';

function formatTalk(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/** Compact rollup card shown above the enriched transcript (V08). */
export function InsightsSummary({
  summary,
  speakerNames,
}: {
  summary: MeetingInsightsSummary;
  speakerNames: Map<string, string>;
}) {
  const totalSentiment =
    summary.sentiment.positive + summary.sentiment.neutral + summary.sentiment.negative;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
      {summary.speakers.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Speakers
          </h4>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {summary.speakers.map((sp) => (
              <span key={sp.label} className="text-foreground">
                <span className={sp.label === 'Me' ? 'text-speaker-self' : 'text-speaker-other'}>
                  {speakerNames.get(sp.label) ?? sp.label}
                </span>{' '}
                <span className="text-muted-foreground">· {formatTalk(sp.talkMs)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {totalSentiment > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sentiment
          </h4>
          <div className="flex gap-4 text-sm">
            <span className={sentimentClass('positive')}>😊 {summary.sentiment.positive}</span>
            <span className={sentimentClass('neutral')}>😐 {summary.sentiment.neutral}</span>
            <span className={sentimentClass('negative')}>😟 {summary.sentiment.negative}</span>
          </div>
        </div>
      )}

      {summary.topEntities.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Top entities
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {summary.topEntities.map((e) => (
              <span
                key={`${e.kind}-${e.text}`}
                className="rounded border border-border px-1.5 py-0.5 text-xs"
                title={e.kind}
              >
                <span className={entityTextClass(e.kind)}>{e.text}</span>
                {e.count > 1 && <span className="ml-1 text-muted-foreground">×{e.count}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
