import React, { memo, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowRightLeft, Mic } from 'lucide-react';
import type { TranscriptSegment } from '../../../shared/types';
import type { SegmentEntitySpan, SegmentInsight } from '../insights/insights-merge';
import { entityUnderlineClass, SENTIMENT_GLYPH, sentimentClass } from '../insights/insight-style';
import { EmptyState } from '../../components/EmptyState';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type TranscriptHighlight = { ids: number[]; nonce: number };

type DisplaySegment = TranscriptSegment & { id?: number };

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * V075 ROADMAP_02 + ROADMAP_03: render `seg.text` with:
 *   - internal paragraph breaks at `seg.paragraphBreaks` (block 02) — each
 *     offset inserts a blank-line gap so long single-speaker monologues are
 *     readable;
 *   - filler tokens at `seg.wordSpans` rendered in a muted/italic style
 *     (block 03) so transcript fidelity wins without filler tokens stealing
 *     visual focus.
 * When neither is present, returns the plain text.
 */
type StyledSpan = { start: number; end: number; className: string };

/**
 * Build the styled spans to weave into a segment: filler tokens (muted/italic,
 * V075) plus, when insights exist (V08), NER entity underlines. Entities win on
 * overlap; the result is sorted + non-overlapping.
 */
function buildStyledSpans(seg: DisplaySegment, entitySpans: SegmentEntitySpan[]): StyledSpan[] {
  const spans: StyledSpan[] = entitySpans.map((e) => ({
    start: e.start,
    end: e.end,
    className: entityUnderlineClass(e.kind),
  }));
  for (const f of seg.wordSpans ?? []) {
    if (!f.isFiller) continue;
    if (spans.some((s) => f.start < s.end && s.start < f.end)) continue; // overlaps an entity
    spans.push({ start: f.start, end: f.end, className: 'italic text-muted-foreground' });
  }
  return spans.sort((a, b) => a.start - b.start);
}

function renderSegmentText(seg: DisplaySegment, entitySpans: SegmentEntitySpan[] = []): React.ReactNode {
  const breaks = seg.paragraphBreaks ?? [];
  const styled = buildStyledSpans(seg, entitySpans);
  if (breaks.length === 0 && styled.length === 0) return seg.text;
  // Split text into paragraph chunks first.
  const chunks: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const offset of breaks) {
    if (offset > cursor && offset <= seg.text.length) {
      chunks.push({ start: cursor, end: offset });
      cursor = offset;
    }
  }
  chunks.push({ start: cursor, end: seg.text.length });
  // Within each chunk, weave plain text + styled (filler/entity) runs.
  return chunks.map((chunk, i) => {
    const nodes: React.ReactNode[] = [];
    let pos = chunk.start;
    for (const span of styled) {
      if (span.end <= chunk.start) continue;
      if (span.start >= chunk.end) break;
      const start = Math.max(span.start, chunk.start);
      const end = Math.min(span.end, chunk.end);
      if (start > pos) nodes.push(seg.text.slice(pos, start));
      nodes.push(
        <span key={`s-${i}-${start}`} className={span.className}>
          {seg.text.slice(start, end)}
        </span>,
      );
      pos = end;
    }
    if (pos < chunk.end) nodes.push(seg.text.slice(pos, chunk.end));
    return (
      <span key={i}>
        {i > 0 && <span className="mt-2 block" aria-hidden="true" />}
        {nodes}
      </span>
    );
  });
}

// Memoized so React skips re-rendering unchanged rows during rapid segment arrival.
const Line = memo(function Line({
  seg,
  displayLabel,
  interim,
  highlighted,
  speakerNames,
  onRenameSpeaker,
  onReassignSegment,
  distinctRawLabels,
  insight,
}: {
  seg: DisplaySegment;
  /** Resolved display name (speakerNames.get(rawLabel) ?? rawLabel) — pre-computed by parent. */
  displayLabel: string;
  interim?: boolean;
  highlighted?: boolean;
  /** Full map for the reassign dropdown so it can show friendly names. */
  speakerNames?: Map<string, string>;
  onRenameSpeaker?: (rawLabel: string, displayName: string) => void;
  onReassignSegment?: (segmentId: number, newRawLabel: string) => void;
  distinctRawLabels?: string[];
  /** V08 — Gladia post-call overlay for this segment (entity spans + sentiment). */
  insight?: SegmentInsight;
}) {
  const isMe = seg.channel === 0;

  // ── Inline rename state ────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = (): void => {
    if (!onRenameSpeaker || interim) return;
    setEditValue(displayLabel);
    setEditing(true);
  };

  const commitEdit = (): void => {
    if (!onRenameSpeaker) return;
    setEditing(false);
    const trimmed = editValue.trim();
    // Empty value → revert to raw label (parent interprets this as a clear).
    onRenameSpeaker(seg.speakerLabel, trimmed || seg.speakerLabel);
  };

  const cancelEdit = (): void => setEditing(false);

  // Show the reassign button only for finalized segments with more than one speaker label.
  const canReassign =
    !interim &&
    seg.id !== undefined &&
    !!onReassignSegment &&
    !!distinctRawLabels &&
    distinctRawLabels.length > 1;

  // Other labels to reassign to (all labels except this segment's current one).
  const otherLabels = canReassign
    ? distinctRawLabels!.filter((l) => l !== seg.speakerLabel)
    : [];

  return (
    <div
      data-segment-id={seg.id}
      className={`group rounded px-1 transition-colors ${interim ? 'opacity-50' : ''} ${
        highlighted ? 'bg-warning/20' : ''
      }`}
    >
      {/* Speaker label — click to rename (finalized segments only) */}
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') cancelEdit();
          }}
          className={`mr-2 w-24 rounded border border-input bg-muted px-1 py-0 text-xs font-semibold focus:outline-none ${
            isMe ? 'text-speaker-self' : 'text-speaker-other'
          }`}
        />
      ) : (
        <span
          role={onRenameSpeaker && !interim ? 'button' : undefined}
          tabIndex={onRenameSpeaker && !interim ? 0 : undefined}
          onClick={startEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') startEdit();
          }}
          title={onRenameSpeaker && !interim ? 'Click to rename speaker' : undefined}
          className={`mr-2 rounded text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring ${isMe ? 'text-speaker-self' : 'text-speaker-other'} ${
            onRenameSpeaker && !interim ? 'cursor-pointer hover:underline' : ''
          }`}
        >
          {displayLabel}
        </span>
      )}

      <span className="mr-2 text-[11px] tabular-nums text-muted-foreground">{formatTime(seg.startMs)}</span>
      {insight?.sentiment && (
        <span
          className={`mr-2 text-xs ${sentimentClass(insight.sentiment.label)}`}
          title={
            insight.sentiment.emotion
              ? `${insight.sentiment.label} · ${insight.sentiment.emotion}`
              : insight.sentiment.label
          }
        >
          {SENTIMENT_GLYPH[insight.sentiment.label]}
        </span>
      )}
      <span className="text-sm leading-relaxed text-foreground">
        {renderSegmentText(seg, insight?.entitySpans)}
      </span>

      {/* Reassign menu — visible on hover for finalized segments with multiple speakers */}
      {canReassign && otherLabels.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Reassign this segment to a different speaker"
              title="Reassign this segment to a different speaker"
              className="ml-1.5 inline-flex align-middle text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <ArrowRightLeft />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {otherLabels.map((rawL) => (
              // seg.id is defined — canReassign guards that
              <DropdownMenuItem key={rawL} onSelect={() => onReassignSegment!(seg.id!, rawL)}>
                {speakerNames?.get(rawL) ?? rawL}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});

export function TranscriptPanel({
  finals,
  interims,
  highlight,
  speakerNames,
  onRenameSpeaker,
  onReassignSegment,
  distinctRawLabels,
  segmentInsights,
}: {
  finals: DisplaySegment[];
  interims: TranscriptSegment[];
  highlight?: TranscriptHighlight | null;
  /** rawLabel → displayName mapping. Stable reference — only changes on rename. */
  speakerNames?: Map<string, string>;
  onRenameSpeaker?: (rawLabel: string, displayName: string) => void;
  onReassignSegment?: (segmentId: number, newRawLabel: string) => void;
  distinctRawLabels?: string[];
  /** V08 — per-segment-id Gladia overlay (entity spans + sentiment) for the weave. */
  segmentInsights?: Map<number, SegmentInsight>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // All rows = finals + interims (interims rendered at the bottom, not virtualized
  // since there are at most 2 and they change rapidly).
  const virtualizer = useVirtualizer({
    count: finals.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  // Live auto-scroll while pinned to the bottom (PRODUCT_SPEC.md §8.2).
  // Use the virtualizer's scrollToIndex so it coordinates with the virtual list.
  useEffect(() => {
    if (pinned.current && finals.length > 0) {
      virtualizer.scrollToIndex(finals.length - 1, { align: 'end' });
    }
    // interims change too — scroll to keep them visible
    if (pinned.current && interims.length > 0) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [finals.length, interims.length, virtualizer]);

  // Source-link jump (§8.4): scroll to the first cited segment and flash a
  // highlight on all of them, then clear.
  useEffect(() => {
    if (!highlight || highlight.ids.length === 0) return;
    setHighlightedIds(new Set(highlight.ids));
    pinned.current = false;

    // Find the row index in `finals` for the first highlighted segment id.
    const targetIndex = finals.findIndex(
      (seg) => seg.id !== undefined && highlight.ids.includes(seg.id),
    );
    if (targetIndex !== -1) {
      virtualizer.scrollToIndex(targetIndex, { align: 'center', behavior: 'smooth' });
    }

    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setHighlightedIds(new Set()), 2600);
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [highlight]); // finals and virtualizer are stable refs — no need to re-run on every render

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const empty = finals.length === 0 && interims.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Live transcript</div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4"
      >
        {empty ? (
          <EmptyState
            icon={Mic}
            title="Nothing captured yet"
            description={'Start recording to see the live transcript. CH0 (your mic) is labelled “Me”; CH1 (system audio) speakers are split by diarization.'}
          />
        ) : (
          <>
            {/* Virtualized finals list */}
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const seg = finals[item.index];
                const displayLabel = speakerNames?.get(seg.speakerLabel) ?? seg.speakerLabel;
                const insight = seg.id !== undefined ? segmentInsights?.get(seg.id) : undefined;
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${item.start}px)`,
                    }}
                    className="pb-2.5"
                  >
                    <Line
                      seg={seg}
                      displayLabel={displayLabel}
                      highlighted={seg.id !== undefined && highlightedIds.has(seg.id)}
                      speakerNames={speakerNames}
                      onRenameSpeaker={onRenameSpeaker}
                      onReassignSegment={onReassignSegment}
                      distinctRawLabels={distinctRawLabels}
                      insight={insight}
                    />
                  </div>
                );
              })}
            </div>
            {/* Interims are few (≤2) and change rapidly — rendered outside the virtualizer */}
            <div className="space-y-2.5">
              {interims.map((seg) => (
                <Line
                  key={`interim-${seg.channel}`}
                  seg={seg}
                  displayLabel={speakerNames?.get(seg.speakerLabel) ?? seg.speakerLabel}
                  interim
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
