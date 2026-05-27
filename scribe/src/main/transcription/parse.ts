import type { TranscriptSegment } from '../../shared/types';

// Pure mapping from a Deepgram streaming "Results" message to TranscriptSegments.
// Kept side-effect free so it can be unit-tested without a socket.
//
// Two modes:
//  - Legacy multichannel (2-channel): channel 0 is the mic → always "Me";
//    channel 1 is system audio → split by diarization speaker (PRODUCT_SPEC.md §6.3).
//  - Single-channel (V05 ROADMAP_02): one mono stream carries everyone, split by
//    diarization speaker into "Speaker N". The local user is NOT identified here —
//    main reassigns the mic-dominant speaker to "Me" using the mic-energy signal.
//    Segments are emitted on channel 1 ("other") as a placeholder until then.

type DeepgramWord = {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number;
};

type DeepgramAlternative = { transcript?: string; words?: DeepgramWord[] };

type DeepgramResult = {
  type?: string;
  channel_index?: number[];
  is_final?: boolean;
  start?: number;
  duration?: number;
  channel?: { alternatives?: DeepgramAlternative[] };
};

export function parseDeepgramMessage(
  message: unknown,
  opts?: { singleChannel?: boolean },
): TranscriptSegment[] {
  const result = message as DeepgramResult;
  if (result.type !== 'Results' || !result.channel) return [];

  const alternative = result.channel.alternatives?.[0];
  const transcript = alternative?.transcript?.trim();
  if (!alternative || !transcript) return [];

  const singleChannel = opts?.singleChannel === true;
  const channel: 0 | 1 = (result.channel_index?.[0] ?? 0) === 0 ? 0 : 1;
  const isFinal = result.is_final === true;
  const baseStartMs = (result.start ?? 0) * 1000;
  const baseEndMs = ((result.start ?? 0) + (result.duration ?? 0)) * 1000;

  // Legacy multichannel mic channel: everything is the local user. In single-channel
  // mode there is no dedicated mic channel — all audio is diarized below.
  if (!singleChannel && channel === 0) {
    return [
      {
        text: transcript,
        channel: 0,
        speakerLabel: 'Me',
        startMs: baseStartMs,
        endMs: baseEndMs,
        isFinal,
      },
    ];
  }

  // Finalized: split into per-speaker runs for clean attribution. Emitted on the
  // "other" channel (1); main may reassign the mic-dominant speaker to "Me".
  const words = alternative.words ?? [];
  if (isFinal && words.length > 0) {
    return splitBySpeaker(words);
  }

  // Interim (or no word-level data): one in-progress line.
  const firstSpeaker = words[0]?.speaker;
  const speakerLabel = typeof firstSpeaker === 'number' ? `Speaker ${firstSpeaker + 1}` : 'Speaker';
  return [
    { text: transcript, channel: 1, speakerLabel, startMs: baseStartMs, endMs: baseEndMs, isFinal },
  ];
}

function splitBySpeaker(words: DeepgramWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let run: { speaker: number; parts: string[]; startMs: number; endMs: number } | null = null;

  for (const word of words) {
    const speaker = word.speaker ?? 0;
    const text = word.punctuated_word ?? word.word;
    if (!run || run.speaker !== speaker) {
      if (run) segments.push(runToSegment(run));
      run = { speaker, parts: [text], startMs: word.start * 1000, endMs: word.end * 1000 };
    } else {
      run.parts.push(text);
      run.endMs = word.end * 1000;
    }
  }
  if (run) segments.push(runToSegment(run));
  return segments;
}

function runToSegment(run: {
  speaker: number;
  parts: string[];
  startMs: number;
  endMs: number;
}): TranscriptSegment {
  return {
    text: run.parts.join(' '),
    channel: 1,
    speakerLabel: `Speaker ${run.speaker + 1}`,
    startMs: run.startMs,
    endMs: run.endMs,
    isFinal: true,
  };
}
