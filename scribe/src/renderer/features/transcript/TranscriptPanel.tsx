import { memo, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TranscriptSegment } from '../../../shared/types';

export type TranscriptHighlight = { ids: number[]; nonce: number };

type DisplaySegment = TranscriptSegment & { id?: number };

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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

  // ── Reassign dropdown state ────────────────────────────────────────────────
  const [showReassign, setShowReassign] = useState(false);
  const reassignRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!showReassign) return;
    const handler = (e: MouseEvent): void => {
      if (reassignRef.current && !reassignRef.current.contains(e.target as Node)) {
        setShowReassign(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showReassign]);

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
        highlighted ? 'bg-amber-400/20' : ''
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
          className={`mr-2 w-24 rounded border border-neutral-600 bg-neutral-800 px-1 py-0 text-xs font-semibold focus:outline-none ${
            isMe ? 'text-emerald-400' : 'text-sky-400'
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
          className={`mr-2 text-xs font-semibold ${isMe ? 'text-emerald-400' : 'text-sky-400'} ${
            onRenameSpeaker && !interim ? 'cursor-pointer hover:underline' : ''
          }`}
        >
          {displayLabel}
        </span>
      )}

      <span className="mr-2 text-[11px] tabular-nums text-neutral-600">{formatTime(seg.startMs)}</span>
      <span className="text-sm leading-relaxed text-neutral-200">{seg.text}</span>

      {/* Reassign icon — visible on hover for finalized segments with multiple speakers */}
      {canReassign && otherLabels.length > 0 && (
        <span ref={reassignRef} className="relative ml-1.5 inline-block align-middle">
          <button
            type="button"
            onClick={() => setShowReassign((v) => !v)}
            title="Reassign this segment to a different speaker"
            className="rounded px-1 text-[10px] text-neutral-600 opacity-0 transition-opacity hover:text-neutral-300 group-hover:opacity-100"
          >
            ⇄
          </button>
          {showReassign && (
            <div className="absolute left-0 top-full z-10 mt-1 min-w-[7rem] rounded border border-neutral-700 bg-neutral-900 py-1 shadow-lg">
              {otherLabels.map((rawL) => (
                <button
                  key={rawL}
                  type="button"
                  onClick={() => {
                    setShowReassign(false);
                    // seg.id is defined — canReassign guards that
                    onReassignSegment!(seg.id!, rawL);
                  }}
                  className="block w-full px-3 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  {speakerNames?.get(rawL) ?? rawL}
                </button>
              ))}
            </div>
          )}
        </span>
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
}: {
  finals: DisplaySegment[];
  interims: TranscriptSegment[];
  highlight?: TranscriptHighlight | null;
  /** rawLabel → displayName mapping. Stable reference — only changes on rename. */
  speakerNames?: Map<string, string>;
  onRenameSpeaker?: (rawLabel: string, displayName: string) => void;
  onReassignSegment?: (segmentId: number, newRawLabel: string) => void;
  distinctRawLabels?: string[];
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
      <div className="mb-3 text-xs uppercase tracking-wide text-neutral-500">Live transcript</div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4"
      >
        {empty ? (
          <p className="text-sm leading-relaxed text-neutral-600">
            Transcript appears here once you start. CH0 (your mic) is labelled "Me"; CH1 (system
            audio) speakers are separated by diarization.
          </p>
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
