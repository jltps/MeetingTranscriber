import type { TranscriptSegment } from '../../shared/types';
import type { AudioCaptureMode } from '../../shared/ipc-contract';
import type { DeepgramWordView } from './parse';

// Pure mic-energy "Me" attribution for single-channel (mono) transcription
// (V05 ROADMAP_02, V062 ROADMAP_01, V073).
//
// In mono mode the cloud diarizer labels everyone "Speaker N". We recover the
// local user by correlating each word's time window with the per-frame mic vs
// system RMS levels the capture worklet sends: if the mic clearly dominated
// while those words were spoken, it's "Me". The levels are scalars, never
// audio bytes (§1.1).
//
// V073: the dominance threshold is no longer a constant. When the user is on
// laptop speakers, their voice leaks into the mic ("bleed") and the segment-
// level heuristic mis-attributes remote speakers to "Me". We measure bleed
// via the normalised cross-correlation of the mic and system RMS envelopes
// and raise the dominance bar in proportion. The user can also force the
// regime via the AudioCaptureMode setting.

/** One per-frame energy reading, keyed to the audio offset (ms) it covers. */
export type EnergySample = { tMs: number; mic: number; sys: number };

export type MeAttributionOptions = {
  /** Lenient window padding (ms) around a segment when sampling energy. */
  windowPadMs?: number;
  /** Mic RMS floor — below this the user isn't really speaking (filters silence/noise). */
  micFloor?: number;
  /** How much the mic must exceed the system level to count as the user. */
  dominance?: number;
  /**
   * Audio capture regime (V073). 'auto' lets bleed score drive `dominance`
   * dynamically; 'headphones' assumes none; 'speakers' assumes constant bleed.
   * Defaults to 'auto'.
   */
  captureMode?: AudioCaptureMode;
};

const DEFAULTS: Required<Omit<MeAttributionOptions, 'captureMode'>> = {
  windowPadMs: 150,
  micFloor: 0.01,
  dominance: 1.5,
};

// ─── Bleed score (V073) ────────────────────────────────────────────────────

/** Rolling window (ms) used by `computeBleedScore`. ~10 s of context. */
const BLEED_WINDOW_MS = 10_000;
/** Bleed gain — at full bleed the effective dominance bar is `dominance * (1 + BLEED_GAIN)`. */
const BLEED_GAIN = 2.0;
/** At full bleed micFloor scales up by this much (max). */
const BLEED_FLOOR_GAIN = 1.0;
/** RMS floor below which a frame is considered silence and excluded from correlation. */
const CORRELATION_RMS_FLOOR = 0.005;

/**
 * Normalised zero-lag cross-correlation of the mic and system RMS envelopes
 * over the last `windowMs` ms ending at `endMs`. Returns 0..1: 0 = independent
 * (good — headphones or quiet), 1 = perfectly co-varying (bad — speakers
 * leaking into the mic). Silent frames are excluded so room noise doesn't
 * dominate the score during quiet stretches. Pure; no side effects.
 */
export function computeBleedScore(
  timeline: readonly EnergySample[],
  endMs: number,
  windowMs: number = BLEED_WINDOW_MS,
): number {
  const startMs = endMs - windowMs;
  let n = 0;
  let micMean = 0;
  let sysMean = 0;
  // First pass: means over non-silent frames inside the window.
  for (const s of timeline) {
    if (s.tMs > endMs) break;
    if (s.tMs < startMs) continue;
    if (s.mic < CORRELATION_RMS_FLOOR && s.sys < CORRELATION_RMS_FLOOR) continue;
    micMean += s.mic;
    sysMean += s.sys;
    n++;
  }
  if (n < 4) return 0; // not enough data to call it
  micMean /= n;
  sysMean /= n;
  // Second pass: numerator + variance.
  let num = 0;
  let micVar = 0;
  let sysVar = 0;
  for (const s of timeline) {
    if (s.tMs > endMs) break;
    if (s.tMs < startMs) continue;
    if (s.mic < CORRELATION_RMS_FLOOR && s.sys < CORRELATION_RMS_FLOOR) continue;
    const dm = s.mic - micMean;
    const ds = s.sys - sysMean;
    num += dm * ds;
    micVar += dm * dm;
    sysVar += ds * ds;
  }
  // Guard against floating-point drift on a constant envelope: an ostensibly
  // zero variance can come back as ~1e-30, which gives a meaningless r=1.
  const VAR_EPS = 1e-10;
  if (micVar < VAR_EPS || sysVar < VAR_EPS) return 0;
  const denom = Math.sqrt(micVar * sysVar);
  const r = num / denom;
  // Only positive co-variation counts as bleed; clamp to [0, 1].
  return Math.max(0, Math.min(1, r));
}

/**
 * Translate the user's capture-mode preference into a clamp on the live
 * bleed score: 'auto' uses it as-is, 'headphones' forces 0 (assume none),
 * 'speakers' floors it at 0.5 (assume some bleed always).
 */
function applyCaptureMode(bleed: number, mode: AudioCaptureMode | undefined): number {
  switch (mode ?? 'auto') {
    case 'headphones':
      return 0;
    case 'speakers':
      return Math.max(0.5, bleed);
    case 'auto':
    default:
      return bleed;
  }
}

/**
 * True if the mic clearly dominated the system audio across [startMs, endMs].
 * `timeline` must be ordered ascending by tMs (it is appended in frame order).
 *
 * V073: the effective dominance + micFloor are scaled up by the rolling bleed
 * score so a leaky speaker setup stops mis-classifying remote speech as "Me".
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
  // Pull bleed from the timeline ending at this word's end time, then apply
  // the user's capture-mode clamp.
  const bleed = applyCaptureMode(
    computeBleedScore(timeline, endMs),
    options.captureMode,
  );
  const effDominance = dominance * (1 + BLEED_GAIN * bleed);
  const effFloor = micFloor * (1 + BLEED_FLOOR_GAIN * bleed);
  return mic >= effFloor && mic >= sys * effDominance;
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
 * default pad (see `PER_WORD_WINDOW_PAD_MS`). `micFloor`, `dominance`, and
 * `captureMode` defaults carry over via `MeAttributionOptions`.
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
  const attributed = words.map((w) => ({
    ...w,
    isMe: micDominatedWindow(timeline, w.startMs, w.endMs, effective),
  }));
  return medianFilterIsMe(attributed);
}

/**
 * 1-word median filter (V073): if word *n* has `isMe` different from BOTH
 * neighbours and is short (< 350 ms), flip it. This kills single-word
 * misclassifications ("Yeah." mis-tagged as Me inside a remote monologue, or
 * a one-word remote interjection sneaking into a Me run) without touching
 * longer, deliberate exchanges.
 */
const MEDIAN_FILTER_MAX_MS = 350;
function medianFilterIsMe(words: AttributedWord[]): AttributedWord[] {
  if (words.length < 3) return words;
  const out = words.slice();
  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    const next = out[i + 1];
    if (cur.isMe === prev.isMe) continue;
    if (cur.isMe === next.isMe) continue;
    const dur = cur.endMs - cur.startMs;
    if (dur >= MEDIAN_FILTER_MAX_MS) continue;
    out[i] = { ...cur, isMe: prev.isMe };
  }
  return out;
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
  return autoMergeAdjacentSpeakers(segments);
}

// ─── Auto-merge adjacent remote-speaker fragments (V073 block 03.3) ──────────
//
// Deepgram nova-3 does not preserve a stable speaker identity across short
// pauses — one monologue commonly arrives split across consecutive IDs. When
// two adjacent remote segments are close in time, similar in pacing, and split
// only by Deepgram speaker, the safer bet is that it's one person. We relabel
// the later fragment to match the earlier one. This is conservative — it only
// merges *locally adjacent* fragments inside the same finals batch, so the
// long-range "Speaker 3 reappears 5 minutes later" case is left for the user.

const AUTO_MERGE_MAX_GAP_MS = 800;
const AUTO_MERGE_WORD_RATE_TOL = 0.25; // ±25 %
const AUTO_MERGE_MIN_WORDS = 3; // each fragment must look like real speech, not a stray token

function autoMergeAdjacentSpeakers(
  segments: TranscriptSegment[],
): TranscriptSegment[] {
  if (segments.length < 2) return segments;
  const out: TranscriptSegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.channel === 1 &&
      seg.channel === 1 &&
      prev.speakerLabel !== seg.speakerLabel &&
      seg.startMs - prev.endMs >= 0 &&
      seg.startMs - prev.endMs <= AUTO_MERGE_MAX_GAP_MS &&
      wordCount(prev) >= AUTO_MERGE_MIN_WORDS &&
      wordCount(seg) >= AUTO_MERGE_MIN_WORDS &&
      similarWordRate(prev, seg)
    ) {
      // Treat as the same speaker — extend prev's span/text rather than adding
      // a new fragmented segment. Keep prev's `speakerLabel` (the earlier one).
      out[out.length - 1] = {
        ...prev,
        text: `${prev.text} ${seg.text}`.trim(),
        endMs: seg.endMs,
      };
      continue;
    }
    out.push(seg);
  }
  return out;
}

function wordCount(seg: TranscriptSegment): number {
  return seg.text.trim().split(/\s+/).filter(Boolean).length;
}

function similarWordRate(a: TranscriptSegment, b: TranscriptSegment): boolean {
  const ra = wordRate(a);
  const rb = wordRate(b);
  if (ra <= 0 || rb <= 0) return true; // not enough signal to rule out a merge
  const ratio = ra > rb ? ra / rb : rb / ra;
  return ratio <= 1 + AUTO_MERGE_WORD_RATE_TOL;
}

function wordRate(seg: TranscriptSegment): number {
  const dur = seg.endMs - seg.startMs;
  if (dur <= 0) return 0;
  const words = seg.text.trim().split(/\s+/).filter(Boolean).length;
  return words / (dur / 1000); // words/sec
}
