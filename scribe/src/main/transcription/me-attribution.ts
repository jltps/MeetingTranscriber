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
//
// V076: V073 left the *zero-bleed* baseline at 1.5×, which is too strict for
// the common headphones case — a user speaking at normal volume over a
// normal-volume remote routinely has mic/sys ratios between 1.0 and 1.4 and
// fell into "Speaker N" runs. V076 re-orients the formula so the dominance
// bar **interpolates** from 1.0× at bleed=0 up to the (user-overridable)
// full-bleed cap at bleed=1. Mic floor scaling is unchanged. A second pass
// inside `attributeWords` adds Me-run hysteresis so a brief mic-energy dip
// between syllables (or behind a short remote backchannel) doesn't fracture
// a coherent Me utterance.

/** One per-frame energy reading, keyed to the audio offset (ms) it covers. */
export type EnergySample = { tMs: number; mic: number; sys: number };

export type MeAttributionOptions = {
  /** Lenient window padding (ms) around a segment when sampling energy. */
  windowPadMs?: number;
  /** Mic RMS floor — below this the user isn't really speaking (filters silence/noise). */
  micFloor?: number;
  /**
   * Mic-vs-system ratio required to call a window Me at **full bleed**
   * (cross-correlation score = 1). V076 linearly interpolates from
   * `DOMINANCE_AT_ZERO_BLEED` (1.0×, no leak — mic just needs to match sys)
   * up to this cap at full bleed. Default `DOMINANCE_AT_FULL_BLEED_DEFAULT`.
   */
  dominance?: number;
  /**
   * Audio capture regime (V073). 'auto' lets bleed score drive `dominance`
   * dynamically; 'headphones' assumes none; 'speakers' assumes constant bleed.
   * Defaults to 'auto'.
   */
  captureMode?: AudioCaptureMode;
  /**
   * V076 — internal: multiplier applied to the **final** effective dominance
   * (after the bleed interpolation). The Me-run hysteresis pass uses this to
   * relax the bar at both endpoints (zero and full bleed) without callers
   * needing to know the interpolation shape. Default 1.0.
   */
  dominanceMultiplier?: number;
};

/** V076 — mic-vs-system ratio at bleed=0. Lenient by design: mic just needs to
 * match sys (combined with `micFloor`, this catches normal-volume Me speech
 * that V073's 1.5× baseline flipped to "Speaker N"). */
const DOMINANCE_AT_ZERO_BLEED = 1.0;

/** V076 — default mic-vs-system ratio at bleed=1. Strict by design: under
 * full mic/sys co-variation (laptop-speaker worst case) the mic must clearly
 * dominate. Slightly less strict than V073's full-bleed extreme (4.5×, which
 * was over-strict in practice) while preserving rejection on the existing
 * borderline-bleed cases. */
const DOMINANCE_AT_FULL_BLEED_DEFAULT = 4.0;

const DEFAULTS: Required<
  Omit<MeAttributionOptions, 'captureMode' | 'dominanceMultiplier'>
> = {
  windowPadMs: 150,
  micFloor: 0.01,
  dominance: DOMINANCE_AT_FULL_BLEED_DEFAULT,
};

// ─── Bleed score (V073) ────────────────────────────────────────────────────

/** Rolling window (ms) used by `computeBleedScore`. ~10 s of context. */
const BLEED_WINDOW_MS = 10_000;
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
 * V076: the dominance bar now **interpolates** from `DOMINANCE_AT_ZERO_BLEED`
 * (1.0×) at bleed=0 up to `dominance` (the full-bleed cap, default 4.0×) at
 * bleed=1, instead of starting at 1.5× and scaling up to 4.5×. The common
 * headphones case (bleed≈0) is now lenient by design — mic just needs to
 * match sys (plus exceed the floor).
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
  // V076: linear interpolation from the zero-bleed floor (lenient) to the
  // full-bleed ceiling (strict). At bleed=0   → 1.0×; at bleed=1 → `dominance`.
  // The hysteresis pass in `attributeWords` re-runs this check with a relaxed
  // multiplier so the relaxation reaches the zero-bleed bar (1.0 × 0.7 = 0.7×)
  // not just the full-bleed cap.
  const baseEffDominance =
    DOMINANCE_AT_ZERO_BLEED + (dominance - DOMINANCE_AT_ZERO_BLEED) * bleed;
  const effDominance =
    baseEffDominance * (options.dominanceMultiplier ?? 1.0);
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

/** V076 — time window (ms) after a Me word during which the next non-Me word
 * gets a relaxed dominance bar. 1.5 s comfortably spans inter-syllable gaps
 * and short remote backchannels ("yeah", "right") without bridging a real
 * speaker change. */
const HYSTERESIS_WINDOW_MS = 1500;

/** V076 — multiplier applied to the dominance bar during the hysteresis
 * window. 0.7 ≈ "30 % more lenient"; mic floor is unchanged so silence still
 * wins and a true loud remote run still flips off Me cleanly. */
const HYSTERESIS_DOMINANCE_FACTOR = 0.7;

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
  const attributed: AttributedWord[] = words.map((w) => ({
    ...w,
    isMe: micDominatedWindow(timeline, w.startMs, w.endMs, effective),
  }));
  // V076: Me-run hysteresis. Once a word is Me, the next ≤ HYSTERESIS_WINDOW_MS
  // of borderline words get a relaxed dominance bar so a brief mic-energy dip
  // (between syllables, behind a remote backchannel) doesn't fracture a coherent
  // Me utterance. Runs *before* the filler-inherit + median-filter passes so
  // they see the hysteresis-corrected sequence (V075 ROADMAP_03 invariant:
  // fillers inherit from a coherent non-filler run).
  applyMeRunHysteresis(attributed, timeline, effective);
  // V075 ROADMAP_03: short isolated fillers (≤ FILLER_INHERIT_MAX_MS) are
  // unreliable per-word dominance subjects — a 100 ms "uh" has too little
  // energy info to classify cleanly. Override their isMe to match the
  // nearest non-filler neighbour BEFORE the median filter runs so the
  // median filter sees a coherent run.
  inheritShortFillerAttribution(attributed);
  return medianFilterIsMe(attributed);
}

/**
 * V076 — Me-run hysteresis. For each non-Me word that starts within
 * `HYSTERESIS_WINDOW_MS` of the previous Me word's end, re-evaluate it with a
 * `HYSTERESIS_DOMINANCE_FACTOR`-relaxed dominance bar. If the relaxed check
 * passes, flip it to Me and slide the cursor forward — so a chain of
 * marginal words can be rescued from one initial Me anchor, but a true
 * 2-second remote run breaks the chain (cursor goes stale). Mutates in place.
 *
 * The mic floor + bleed scaling are *not* relaxed: silence still loses and a
 * mic-quiet-system-loud remote run is still rejected by the floor check.
 */
function applyMeRunHysteresis(
  words: AttributedWord[],
  timeline: readonly EnergySample[],
  effective: MeAttributionOptions,
): void {
  let lastMeEndMs = -Infinity;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.isMe) {
      lastMeEndMs = w.endMs;
      continue;
    }
    if (w.startMs - lastMeEndMs > HYSTERESIS_WINDOW_MS) continue;
    const relaxed = micDominatedWindow(timeline, w.startMs, w.endMs, {
      ...effective,
      dominanceMultiplier:
        (effective.dominanceMultiplier ?? 1.0) * HYSTERESIS_DOMINANCE_FACTOR,
    });
    if (relaxed) {
      words[i] = { ...w, isMe: true };
      lastMeEndMs = w.endMs;
    }
  }
}

/** V075 ROADMAP_03 — duration ceiling for the filler-inherit pass (ms). */
const FILLER_INHERIT_MAX_MS = 200;

/**
 * V075 ROADMAP_03 — short fillers inherit their nearest non-filler neighbour's
 * `isMe`. Walks once, preferring the previous non-filler word; falls back to
 * the next. Mutates in place — runs on the array `attributeWords` is about
 * to return, so the median-filter pass after sees the cleaned-up run.
 */
function inheritShortFillerAttribution(words: AttributedWord[]): void {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w.isFiller) continue;
    if (w.endMs - w.startMs > FILLER_INHERIT_MAX_MS) continue;
    // Previous non-filler.
    let donor: AttributedWord | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (!words[j].isFiller) {
        donor = words[j];
        break;
      }
    }
    // Fall back to next non-filler.
    if (!donor) {
      for (let j = i + 1; j < words.length; j++) {
        if (!words[j].isFiller) {
          donor = words[j];
          break;
        }
      }
    }
    if (donor && donor.isMe !== w.isMe) words[i] = { ...w, isMe: donor.isMe };
  }
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
 *
 * V075 ROADMAP_02: paragraph index is a **soft** hint here — a paragraph change
 * between two same-attribution adjacent words still keeps them in one segment
 * (Deepgram's paragraph breaks are noisier than the isMe boundaries we already
 * validate). The change is recorded as a `paragraphBreaks: number[]` (character
 * offsets into the segment's `text` where the paragraph index increased) so the
 * renderer can show an internal break on long single-speaker monologues.
 * `paragraphBreaks` is omitted (not `[]`) when no internal breaks exist, so
 * the persistence layer can leave the column NULL.
 *
 * paragraphIndex also feeds `autoMergeAdjacentSpeakers` downstream as a strong
 * merge signal for adjacent remote fragments inside the same Deepgram paragraph.
 */
export function groupAttributedWords(
  words: readonly AttributedWord[],
): TranscriptSegment[] {
  // Parallel arrays: segments[i] and meta[i] describe the same run.
  // meta carries the segment's paragraph range so autoMergeAdjacentSpeakers can
  // merge same-paragraph remote fragments unconditionally without re-walking
  // words.
  const segments: TranscriptSegment[] = [];
  const meta: SegmentMeta[] = [];

  type Run = {
    isMe: boolean;
    deepgramSpeaker: number;
    /** First and last paragraph indices seen in this run. */
    firstParagraph: number;
    lastParagraph: number;
    parts: string[];
    /** Character offsets into the joined text where paragraphIndex increased. */
    paragraphBreaks: number[];
    /** V075 ROADMAP_03 — filler spans inside the joined text (char offsets). */
    fillerSpans: { start: number; end: number }[];
    /** Running character length of `parts.join(' ')` — kept in sync as parts grows. */
    joinedLength: number;
    startMs: number;
    endMs: number;
  };
  let run: Run | null = null;

  const flush = (r: Run): void => {
    const base: TranscriptSegment = r.isMe
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
        };
    if (r.paragraphBreaks.length > 0) base.paragraphBreaks = r.paragraphBreaks;
    if (r.fillerSpans.length > 0) {
      base.wordSpans = r.fillerSpans.map((s) => ({ ...s, isFiller: true }));
    }
    segments.push(base);
    meta.push({ firstParagraph: r.firstParagraph, lastParagraph: r.lastParagraph });
  };

  for (const w of words) {
    if (run === null) {
      run = {
        isMe: w.isMe,
        deepgramSpeaker: w.deepgramSpeaker,
        firstParagraph: w.paragraphIndex,
        lastParagraph: w.paragraphIndex,
        parts: [w.text],
        paragraphBreaks: [],
        fillerSpans: w.isFiller ? [{ start: 0, end: w.text.length }] : [],
        joinedLength: w.text.length,
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
        firstParagraph: w.paragraphIndex,
        lastParagraph: w.paragraphIndex,
        parts: [w.text],
        paragraphBreaks: [],
        fillerSpans: w.isFiller ? [{ start: 0, end: w.text.length }] : [],
        joinedLength: w.text.length,
        startMs: w.startMs,
        endMs: w.endMs,
      };
    } else {
      // Inside the run. Before appending the word, record a paragraph break at
      // the current joinedLength + 1 (the space separator) iff the word's
      // paragraph index moved past the run's current paragraph index. Char
      // offset points at the first character of the new paragraph's first word.
      if (w.paragraphIndex > run.lastParagraph) {
        run.paragraphBreaks.push(run.joinedLength + 1);
        run.lastParagraph = w.paragraphIndex;
      }
      const wordStart = run.joinedLength + 1; // skip the space separator
      run.parts.push(w.text);
      run.joinedLength += 1 + w.text.length; // space + word
      run.endMs = w.endMs;
      if (w.isFiller) {
        run.fillerSpans.push({ start: wordStart, end: wordStart + w.text.length });
      }
    }
  }
  if (run) flush(run);
  return autoMergeAdjacentSpeakers(segments, meta);
}

/** Internal: paragraph range for one emitted segment, used by autoMerge only. */
type SegmentMeta = { firstParagraph: number; lastParagraph: number };

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
  meta?: readonly SegmentMeta[],
): TranscriptSegment[] {
  if (segments.length < 2) return segments;
  const out: TranscriptSegment[] = [];
  const outMeta: SegmentMeta[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segMeta = meta?.[i];
    const prev = out[out.length - 1];
    const prevMeta = outMeta[outMeta.length - 1];
    if (
      prev &&
      prev.channel === 1 &&
      seg.channel === 1 &&
      prev.speakerLabel !== seg.speakerLabel &&
      seg.startMs - prev.endMs >= 0
    ) {
      // V075 ROADMAP_02 fast-path: two adjacent remote fragments inside the
      // same Deepgram paragraph are almost certainly one speaker that Deepgram
      // fragmented — Deepgram's own paragraph boundaries are diarization-aware.
      // Skip the V073 word-rate / gap / ≥3-words heuristic when paragraphs match.
      // `-1` is the V075 ROADMAP_01 sentinel for "no paragraph data on this
      // message" — gate the fast-path on a non-negative match so the legacy
      // multichannel + no-paragraphs paths behave exactly as V073 did.
      const samePara =
        !!segMeta &&
        !!prevMeta &&
        segMeta.firstParagraph >= 0 &&
        prevMeta.lastParagraph >= 0 &&
        segMeta.firstParagraph === prevMeta.lastParagraph;
      const heuristicMerge =
        seg.startMs - prev.endMs <= AUTO_MERGE_MAX_GAP_MS &&
        wordCount(prev) >= AUTO_MERGE_MIN_WORDS &&
        wordCount(seg) >= AUTO_MERGE_MIN_WORDS &&
        similarWordRate(prev, seg);
      if (samePara || heuristicMerge) {
        // Treat as the same speaker — extend prev's span/text rather than adding
        // a new fragmented segment. Keep prev's `speakerLabel` (the earlier one).
        // paragraphBreaks: keep prev's; if the seg crosses a paragraph boundary
        // relative to prev's end, record a break at the join offset (where seg's
        // text starts inside the merged text). wordSpans (V075 ROADMAP_03):
        // shift seg's spans by the offset and concatenate so filler positions
        // stay correct across the merge.
        const mergedText = `${prev.text} ${seg.text}`.trim();
        const breaks = prev.paragraphBreaks ? [...prev.paragraphBreaks] : [];
        if (
          segMeta &&
          prevMeta &&
          segMeta.firstParagraph > prevMeta.lastParagraph
        ) {
          breaks.push(prev.text.length + 1);
        }
        if (seg.paragraphBreaks) {
          const offset = prev.text.length + 1;
          for (const b of seg.paragraphBreaks) breaks.push(b + offset);
        }
        const spans = prev.wordSpans ? [...prev.wordSpans] : [];
        if (seg.wordSpans) {
          const offset = prev.text.length + 1;
          for (const s of seg.wordSpans) {
            spans.push({ start: s.start + offset, end: s.end + offset, isFiller: s.isFiller });
          }
        }
        const merged: TranscriptSegment = {
          ...prev,
          text: mergedText,
          endMs: seg.endMs,
        };
        if (breaks.length > 0) merged.paragraphBreaks = breaks;
        if (spans.length > 0) merged.wordSpans = spans;
        else delete merged.wordSpans;
        out[out.length - 1] = merged;
        if (segMeta) {
          outMeta[outMeta.length - 1] = {
            firstParagraph: prevMeta?.firstParagraph ?? segMeta.firstParagraph,
            lastParagraph: segMeta.lastParagraph,
          };
        }
        continue;
      }
    }
    out.push(seg);
    if (segMeta) outMeta.push(segMeta);
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
