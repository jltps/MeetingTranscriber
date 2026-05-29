import { useState, type ReactNode } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import type { MeetingInsights } from '../../../shared/types';
import { EmptyState } from '../../components/EmptyState';
import {
  aggregateInsights,
  type EntityStat,
  type Occurrence,
} from './insights-aggregate';
import {
  emotionGlyph,
  emotionLabel,
  entityTextClass,
  SENTIMENT_GLYPH,
  SENTIMENT_LABEL,
  sentimentClass,
} from './insight-style';

function formatTalk(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Clickable occurrence chips (mm:ss) that jump the live transcript via onSeek. */
function Occurrences({
  occurrences,
  onSeek,
}: {
  occurrences: Occurrence[];
  onSeek?: (startMs: number) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 pl-7">
      {occurrences.map((o, i) => (
        <button
          key={`${o.startMs}-${i}`}
          type="button"
          disabled={!onSeek}
          onClick={() => onSeek?.(o.startMs)}
          title={`${o.speakerLabel}: ${o.text}`}
          className="rounded border border-border px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground transition-colors enabled:hover:bg-accent enabled:hover:text-foreground disabled:opacity-70"
        >
          {formatClock(o.startMs)}
        </button>
      ))}
    </div>
  );
}

/** A header row that expands to show the occurrences that produced it. */
function ExpandableRow({
  header,
  count,
  occurrences,
  onSeek,
}: {
  header: ReactNode;
  count: number;
  occurrences: Occurrence[];
  onSeek?: (startMs: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-sm hover:bg-accent/50"
        aria-expanded={open}
      >
        <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        {header}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{count}×</span>
      </button>
      {open && <Occurrences occurrences={occurrences} onSeek={onSeek} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function EntityRow({ e, onSeek }: { e: EntityStat; onSeek?: (startMs: number) => void }) {
  return (
    <ExpandableRow
      count={e.count}
      occurrences={e.occurrences}
      onSeek={onSeek}
      header={
        <span className="truncate">
          <span className={`font-medium ${entityTextClass(e.kind)}`}>{e.text}</span>{' '}
          <span className="text-xs text-muted-foreground">· {e.kind}</span>
        </span>
      }
    />
  );
}

/**
 * Post-call Insights dashboard (V081). Does NOT repeat the transcript (that lives
 * in the live transcript window) — instead it summarizes who spoke and for how
 * long, the full spread of sentiments + emotions, and the entities mentioned,
 * each expandable to the moments in the call where they occurred (click to jump).
 */
export function InsightsView({
  insights,
  speakerNames,
  onSeek,
}: {
  insights: MeetingInsights | null;
  speakerNames: Map<string, string>;
  onSeek?: (startMs: number) => void;
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

  const agg = aggregateInsights(insights.utterances);
  const name = (label: string): string => speakerNames.get(label) ?? label;

  return (
    <div className="space-y-5">
      {agg.speakers.length > 0 && (
        <Section title="Speakers">
          {agg.speakers.map((s) => (
            <p key={s.label} className="text-sm text-foreground">
              <span className={s.label === 'Me' ? 'text-speaker-self' : 'text-speaker-other'}>
                {name(s.label)}
              </span>{' '}
              spoke for {formatTalk(s.talkMs)}, {s.pct}% of the talk time.
            </p>
          ))}
        </Section>
      )}

      {agg.sentiments.length > 0 && (
        <Section title="Sentiment">
          <p className="text-[11px] text-muted-foreground">
            How the conversation felt across {agg.sentiments.reduce((n, s) => n + s.count, 0)} analysed
            lines. Expand a row to jump to where it happened.
          </p>
          {agg.sentiments.map((s) => (
            <ExpandableRow
              key={s.label}
              count={s.count}
              occurrences={s.occurrences}
              onSeek={onSeek}
              header={
                <span className={`flex items-center gap-1.5 ${sentimentClass(s.label)}`}>
                  <span>{SENTIMENT_GLYPH[s.label]}</span>
                  <span className="font-medium">{SENTIMENT_LABEL[s.label]}</span>
                  <span className="text-xs text-muted-foreground">{s.pct}%</span>
                </span>
              }
            />
          ))}
        </Section>
      )}

      {agg.emotions.length > 0 && (
        <Section title="Emotions">
          <p className="text-[11px] text-muted-foreground">
            Emotions detected in the speech. Expand to see when each came up.
          </p>
          {agg.emotions.map((e) => (
            <ExpandableRow
              key={e.emotion}
              count={e.count}
              occurrences={e.occurrences}
              onSeek={onSeek}
              header={
                <span className="flex items-center gap-1.5">
                  <span>{emotionGlyph(e.emotion)}</span>
                  <span className="font-medium text-foreground">{emotionLabel(e.emotion)}</span>
                  <span className="text-xs text-muted-foreground">{e.pct}%</span>
                </span>
              }
            />
          ))}
        </Section>
      )}

      {agg.entities.length > 0 && (
        <Section title="Top entities">
          <p className="text-[11px] text-muted-foreground">
            People, organizations, places, and dates mentioned. Expand to jump to each mention.
          </p>
          {agg.entities.map((e) => (
            <EntityRow key={`${e.kind}-${e.text}`} e={e} onSeek={onSeek} />
          ))}
        </Section>
      )}
    </div>
  );
}
