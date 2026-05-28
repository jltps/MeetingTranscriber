import type { TranscriptSegment } from '../../shared/types';
import type { DeepgramWordView } from './parse';

// Pure mic-energy "Me" attribution for single-channel (mono) transcription
// (V05 ROADMAP_02). Kept side-effect free so it can be unit-tested without a socket.
//
// In mono mode the cloud diarizer labels everyone "Speaker N". We recover the local
// user by correlating each segment's time window with the per-frame mic vs system
// RMS levels the capture worklet sends: if the mic clearly dominated while those
// words were spoken, it's "Me". The levels are scalars, never audio bytes (§1.1).

/** One per-frame energy reading, keyed to the audio offset (ms) it covers. */
export type EnergySample = { tMs: number; mic: number; sys: number };

export type MeAttributionOptions = {
  /** Lenient window padding (ms) around a segment when sampling energy. */
  windowPadMs?: number;
  /** Mic RMS floor — below this the user isn't really speaking (filters silence/noise). */
  micFloor?: number;
  /** How much the mic must exceed the system level to count as the user. */
  dominance?: number;
};

const DEFAULTS: Required<MeAttributionOptions> = {
  windowPadMs: 150,
  micFloor: 0.01,
  dominance: 1.5,
};

/**
 * True if the mic clearly dominated the system audio across [startMs, endMs].
 * `timeline` must be ordered ascending by tMs (it is appended in frame order).
 */
export function micDominatedWindow(
  timeline: readonly EnergySample[],
  startMs: number,
  endMs: number,
  options: MeAttributionOptions = {},
): boolean {
  const { windowPadMs, micFloor, dominance } = { ...DEFAULTS, ...options };
  const lo = startMs - windowPadMs;
  const hi = endMs + windowPadMs;
  let micSum = 0;
  let sysSum = 0;
  let n = 0;
  for (const s of timeline) {
    if (s.tMs > hi) break; // ordered ascending — nothing further can match
    if (s.tMs < lo) continue;
    micSum += s.mic;
    sysSum += s.sys;
    n++;
  }
  if (n === 0) return false; // no energy data for this window — can't claim "Me"
  const mic = micSum / n;
  const sys = sysSum / n;
  return mic >= micFloor && mic >= sys * dominance;
}

/**
 * Relabel a mic-dominant segment as the local user (channel 0 = "Me"). Segments
 * already labelled "Me" pass through unchanged. Returns the input untouched when
 * the mic did not dominate, so remote speakers keep their "Speaker N" labels.
 */
export function attributeMe(
  seg: TranscriptSegment,
  timeline: readonly EnergySample[],
  options: MeAttributionOptions = {},
): TranscriptSegment {
  if (seg.speakerLabel === 'Me') return seg;
  if (!micDominatedWindow(timeline, seg.startMs, seg.endMs, options)) return seg;
  return { ...seg, channel: 0, speakerLabel: 'Me' };
}

// ─── Per-word "Me" attribution (V062 ROADMAP_01) ─────────────────────────────
// Deepgram does not preserve a stable speaker identity across a session and
// readily fragments one physical voice into multiple speaker IDs. Per-segment
// averaging also buries the dominance signal on long mixed-speaker windows. We
// decide "Me" per word, then regroup with attribution as the primary partition
// key — so own-voice coalesces into one "Me" run regardless of how many speaker
// IDs Deepgram scattered it across. Remote speakers still split by Deepgram
// speaker exactly as today.

/** Default window pad (ms) for the per-word attribution path. Word time windows
 * are typically 200–800 ms; a tighter pad than the segment-level 150 ms keeps
 * the dominance signal sharp while still absorbing word-boundary jitter. */
const PER_WORD_WINDOW_PAD_MS = 60;

/** A Deepgram word with its per-word "Me" decision attached. */
export type AttributedWord = DeepgramWordView & { isMe: boolean };

/**
 * Decide `isMe` for each word from the energy timeline. Uses the same
 * `micDominatedWindow` heuristic as the segment-level path with a tighter
 * default pad (see `PER_WORD_WINDOW_PAD_MS`). `micFloor` and `dominance`
 * defaults carry over via `MeAttributionOptions`.
 */
export function attributeWords(
  words: readonly DeepgramWordView[],
  timeline: readonly EnergySample[],
  options: MeAttributionOptions = {},
): AttributedWord[] {
  const effective: MeAttributionOptions = {
    windowPadMs: PER_WORD_WINDOW_PAD_MS,
    ...options,
  };
  return words.map((w) => ({
    ...w,
    isMe: micDominatedWindow(timeline, w.startMs, w.endMs, effective),
  }));
}

/**
 * Regroup attributed words into segments with attribution as the **primary**
 * partition key. Consecutive `isMe=true` words fuse into one "Me" segment
 * across Deepgram speaker boundaries (the fragmentation case). Consecutive
 * non-Me words still split on Deepgram-speaker change, preserving remote-speaker
 * separation exactly as the segment-level path does. Empty input → `[]`.
 */
export function groupAttributedWords(
  words: readonly AttributedWord[],
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  type Run = {
    isMe: boolean;
    deepgramSpeaker: number;
    parts: string[];
    startMs: number;
    endMs: number;
  };
  let run: Run | null = null;

  const flush = (r: Run): void => {
    segments.push(
      r.isMe
        ? {
            text: r.parts.join(' '),
            channel: 0,
            speakerLabel: 'Me',
            startMs: r.startMs,
            endMs: r.endMs,
            isFinal: true,
          }
        : {
            text: r.parts.join(' '),
            channel: 1,
            speakerLabel: `Speaker ${r.deepgramSpeaker + 1}`,
            startMs: r.startMs,
            endMs: r.endMs,
            isFinal: true,
          },
    );
  };

  for (const w of words) {
    if (run === null) {
      run = {
        isMe: w.isMe,
        deepgramSpeaker: w.deepgramSpeaker,
        parts: [w.text],
        startMs: w.startMs,
        endMs: w.endMs,
      };
      continue;
    }
    const boundary =
      run.isMe !== w.isMe ||
      (run.isMe === false && w.isMe === false && run.deepgramSpeaker !== w.deepgramSpeaker);
    if (boundary) {
      flush(run);
      run = {
        isMe: w.isMe,
        deepgramSpeaker: w.deepgramSpeaker,
        parts: [w.text],
        startMs: w.startMs,
        endMs: w.endMs,
      };
    } else {
      run.parts.push(w.text);
      run.endMs = w.endMs;
    }
  }
  if (run) flush(run);
  return segments;
}
