import { useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../../../shared/types';

export type TranscriptHighlight = { ids: number[]; nonce: number };

type DisplaySegment = TranscriptSegment & { id?: number };

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function Line({
  seg,
  interim,
  highlighted,
}: {
  seg: DisplaySegment;
  interim?: boolean;
  highlighted?: boolean;
}) {
  const isMe = seg.channel === 0;
  return (
    <div
      data-segment-id={seg.id}
      className={`rounded px-1 transition-colors ${interim ? 'opacity-50' : ''} ${
        highlighted ? 'bg-amber-400/20' : ''
      }`}
    >
      <span className={`mr-2 text-xs font-semibold ${isMe ? 'text-emerald-400' : 'text-sky-400'}`}>
        {seg.speakerLabel}
      </span>
      <span className="mr-2 text-[11px] tabular-nums text-neutral-600">{formatTime(seg.startMs)}</span>
      <span className="text-sm leading-relaxed text-neutral-200">{seg.text}</span>
    </div>
  );
}

export function TranscriptPanel({
  finals,
  interims,
  highlight,
}: {
  finals: DisplaySegment[];
  interims: TranscriptSegment[];
  highlight?: TranscriptHighlight | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live auto-scroll while pinned to the bottom (PRODUCT_SPEC.md §8.2).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [finals, interims]);

  // Source-link jump (§8.4): scroll to the first cited segment and flash a
  // highlight on all of them, then clear.
  useEffect(() => {
    if (!highlight || highlight.ids.length === 0) return;
    setHighlightedIds(new Set(highlight.ids));
    pinned.current = false;
    requestAnimationFrame(() => {
      const target = scrollRef.current?.querySelector(`[data-segment-id="${highlight.ids[0]}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setHighlightedIds(new Set()), 2600);
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [highlight]);

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
        className="flex-1 space-y-2.5 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4"
      >
        {empty ? (
          <p className="text-sm leading-relaxed text-neutral-600">
            Transcript appears here once you start. CH0 (your mic) is labelled “Me”; CH1 (system
            audio) speakers are separated by diarization.
          </p>
        ) : (
          <>
            {finals.map((seg, i) => (
              <Line
                key={seg.id ?? `final-${i}`}
                seg={seg}
                highlighted={seg.id !== undefined && highlightedIds.has(seg.id)}
              />
            ))}
            {interims.map((seg) => (
              <Line key={`interim-${seg.channel}`} seg={seg} interim />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
