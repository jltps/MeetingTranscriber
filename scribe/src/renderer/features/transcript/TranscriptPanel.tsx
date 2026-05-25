import { useEffect, useRef } from 'react';
import type { TranscriptSegment } from '../../../shared/types';

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function Line({ seg, interim }: { seg: TranscriptSegment; interim?: boolean }) {
  const isMe = seg.channel === 0;
  return (
    <div className={interim ? 'opacity-50' : ''}>
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
}: {
  finals: TranscriptSegment[];
  interims: TranscriptSegment[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-scroll only while pinned to the bottom, so scrolling up to read back
  // doesn't fight the live feed (PRODUCT_SPEC.md §8.2).
  const pinned = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [finals, interims]);

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
              <Line key={`final-${i}`} seg={seg} />
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
