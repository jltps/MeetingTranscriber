import { GladiaClient } from '@gladiaio/sdk';
import type {
  LiveV2InitRequest,
  LiveV2SampleRate,
  LiveV2Session,
  LiveV2TranscriptionLanguageCode,
  LiveV2Utterance,
  LiveV2WebSocketMessage,
} from '@gladiaio/sdk';
import type { LanguageSetting, TranscriptSegment } from '../../shared/types';
import type { TranscriptionStatus } from '../../shared/ipc-contract';
import type { TranscriptionSession } from './session';
import {
  createAccumulator,
  normalizeGladia,
  recordNer,
  recordSentiment,
  recordTranscript,
  type GladiaAccumulator,
  type ProviderInsights,
} from './parse-gladia';

// Gladia live STT (solaria-1) behind the shared TranscriptionSession interface
// (CLAUDE.md §5/§6.3 — key + socket live in the main process). The whole
// @gladiaio/sdk surface is confined to this file + parse-gladia.ts, so an SDK
// change can't ripple past these two modules.
//
// Two ways this differs from DeepgramSession:
//  - The SDK reconnects internally (wsRetry), so there is no hand-rolled
//    backoff/RAM-buffer here.
//  - Diarization + NER + sentiment arrive over the same WebSocket as
//    `transcript` / `named_entity_recognition` / `sentiment_analysis` messages,
//    accumulated and emitted once via the optional `onInsights` callback after
//    the session ends (the IPC layer reconciles "Me"/speaker + persists).

// Restart the WS a little before Gladia's hard 3-hour session limit; live
// emissions + accumulated insights carry a cumulative time offset so the
// stitched timeline stays continuous across the handoff.
const HANDOFF_MS = 2.5 * 60 * 60 * 1000;
// Safety net: if `ended` never arrives after stop (network drop mid-post-process),
// finalize with whatever was accumulated so the meeting never gets stuck.
const FINALIZE_TIMEOUT_MS = 90_000;

export type GladiaConfig = {
  apiKey: string;
  languageSetting?: LanguageSetting;
  onLanguageDetected?: (bcp47: string) => void;
  onStatus?: (status: TranscriptionStatus) => void;
};

type SubSession = {
  session: LiveV2Session;
  acc: GladiaAccumulator;
  baseOffsetMs: number;
  ended: boolean;
};

/** Lightweight key check for Settings → "Test connection". Creates an unused
 * live session (no audio is ever sent, so it expires un-billed) and checks the
 * init succeeds. Never logs the response — it carries a tokenized socket URL. */
export async function testGladiaKey(apiKey: string): Promise<void> {
  const res = await fetch('https://api.gladia.io/v2/live', {
    method: 'POST',
    headers: { 'x-gladia-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      encoding: 'wav/pcm',
      sample_rate: 16000,
      bit_depth: 16,
      channels: 1,
      model: 'solaria-1',
    }),
  });
  if (!res.ok) throw new Error(`Gladia rejected the key (HTTP ${res.status}).`);
}

const VALID_SAMPLE_RATES: readonly number[] = [8000, 16000, 32000, 44100, 48000];

function asSampleRate(n: number): LiveV2SampleRate {
  return (VALID_SAMPLE_RATES.includes(n) ? n : 16000) as LiveV2SampleRate;
}

/**
 * Map the app's BCP-47 language to Gladia's ISO-639-1 code (strip region:
 * `pt-PT` → `pt`). Returns null when the base subtag isn't one Gladia accepts —
 * the caller then omits `languages` so Gladia auto-detects, rather than guessing
 * English (CLAUDE.md §1.7).
 */
export function toIso639_1(bcp47: string): LiveV2TranscriptionLanguageCode | null {
  const base = bcp47.toLowerCase().split('-')[0];
  return base && base.length >= 2 ? (base as LiveV2TranscriptionLanguageCode) : null;
}

/**
 * Build the Gladia init request. Pure + exported so the param rules can be
 * unit-tested without opening a socket. Language follows the app setting
 * (§1.7): auto → empty `languages` + `code_switching`; fixed → the mapped ISO
 * code (or auto-detect when unmappable). NER + sentiment are realtime-processing
 * features in the live API.
 */
export function buildGladiaConfig(
  opts: { sampleRate: number; channels: number },
  languageSetting?: LanguageSetting,
): LiveV2InitRequest {
  const setting = languageSetting ?? { mode: 'fixed', bcp47: 'en' };
  const fixedCode = setting.mode === 'fixed' ? toIso639_1(setting.bcp47) : null;
  const language_config =
    setting.mode === 'fixed' && fixedCode
      ? { languages: [fixedCode] }
      : { languages: [], code_switching: true };

  return {
    model: 'solaria-1',
    encoding: 'wav/pcm',
    bit_depth: 16,
    sample_rate: asSampleRate(opts.sampleRate),
    channels: opts.channels,
    language_config,
    realtime_processing: {
      named_entity_recognition: true,
      sentiment_analysis: true,
    },
    messages_config: {
      receive_partial_transcripts: true,
      receive_final_transcripts: true,
      receive_realtime_processing_events: true,
      receive_post_processing_events: true,
    },
  };
}

export class GladiaSession implements TranscriptionSession {
  private client: GladiaClient;
  private subs: SubSession[] = [];
  private current: SubSession | null = null;
  private startOpts: { sampleRate: number; channels: number } | null = null;

  private partialCb: ((seg: TranscriptSegment) => void) | null = null;
  private finalCb: ((seg: TranscriptSegment) => void) | null = null;
  private insightsCb: ((insights: ProviderInsights) => void) | null = null;

  private langDetectedFired = false;
  private startResolved = false;
  private stopped = false;
  private insightsEmitted = false;
  private openFired = false;

  /** Cumulative audio fed so far (ms) — the offset applied at each handoff. */
  private elapsedMs = 0;
  private handoffTimer: ReturnType<typeof setTimeout> | null = null;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private config: GladiaConfig) {
    this.client = new GladiaClient({ apiKey: config.apiKey });
  }

  onPartial(cb: (seg: TranscriptSegment) => void): void {
    this.partialCb = cb;
  }

  onFinal(cb: (seg: TranscriptSegment) => void): void {
    this.finalCb = cb;
  }

  onInsights(cb: (insights: ProviderInsights) => void): void {
    this.insightsCb = cb;
  }

  /** Gladia live session id(s) — multiple across a handoff. Resolved ids only. */
  sessionIds(): string[] {
    return this.subs.map((s) => s.session.sessionId).filter((id): id is string => !!id);
  }

  start(opts: { sampleRate: number; channels: number }): Promise<void> {
    if (!this.config.apiKey) {
      return Promise.reject(
        new Error('Gladia API key not set. Set it in Settings → API keys (or GLADIA_API_KEY).'),
      );
    }
    this.startOpts = opts;
    this.stopped = false;
    return new Promise<void>((resolve, reject) => {
      this.startSubSession(0, resolve, reject);
    });
  }

  pushAudio(pcm: Int16Array): void {
    if (this.stopped || !this.current || !this.startOpts) return;
    const { sampleRate, channels } = this.startOpts;
    if (sampleRate > 0 && channels > 0) {
      this.elapsedMs += (pcm.length / channels / sampleRate) * 1000;
    }
    // Send the raw 16-bit PCM bytes (not the typed array, which would be read
    // element-wise). Audio goes straight to the socket — never to disk (§1.1).
    this.current.session.sendAudio(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearHandoffTimer();
    // Tell the current sub-session to finish; it will post-process and emit
    // `ended`. We do NOT tear down here — the instance stays alive (the IPC
    // layer holds it in its `enriching` set) until insights are emitted.
    try {
      this.current?.session.stopRecording();
    } catch {
      /* already ending */
    }
    // Watchdog so a never-arriving `ended` can't strand the meeting.
    this.finalizeTimer = setTimeout(() => this.finalize(), FINALIZE_TIMEOUT_MS);
    this.maybeFinalize();
  }

  /** Hard teardown without emitting insights — used on app quit (§ dispose). */
  abort(): void {
    this.stopped = true;
    this.insightsEmitted = true; // suppress any late finalize
    this.clearHandoffTimer();
    if (this.finalizeTimer) {
      clearTimeout(this.finalizeTimer);
      this.finalizeTimer = null;
    }
    for (const sub of this.subs) {
      try {
        sub.session.endSession();
        sub.session.removeAllListeners();
      } catch {
        /* best effort */
      }
    }
    this.current = null;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private startSubSession(
    baseOffsetMs: number,
    onConnected?: () => void,
    onEarlyError?: (err: Error) => void,
  ): void {
    if (!this.startOpts) return;
    const session = this.client
      .liveV2()
      .startSession(buildGladiaConfig(this.startOpts, this.config.languageSetting));
    const sub: SubSession = { session, acc: createAccumulator(), baseOffsetMs, ended: false };
    this.subs.push(sub);
    this.current = sub;

    let connectedFired = false;
    const markConnected = (): void => {
      if (!connectedFired) {
        connectedFired = true;
        if (!this.openFired) {
          this.openFired = true;
          this.config.onStatus?.({ state: 'open' });
        }
        if (!this.startResolved) {
          this.startResolved = true;
          onConnected?.();
        }
      }
    };

    session.on('started', () => markConnected());
    session.on('connected', () => markConnected());
    session.on('connecting', () => {
      // SDK is (re)connecting. Surface as reconnecting only once the session was
      // already live, so the first connect doesn't flash "reconnecting".
      if (this.openFired) this.config.onStatus?.({ state: 'reconnecting' });
    });
    session.on('error', (err: Error) => {
      if (!this.startResolved) {
        this.startResolved = true;
        onEarlyError?.(err);
      } else {
        this.config.onStatus?.({ state: 'error', message: err.message });
      }
    });
    session.on('message', (msg: LiveV2WebSocketMessage) => this.handleMessage(sub, msg));
    session.once('ended', () => {
      sub.ended = true;
      this.maybeFinalize();
    });

    // Arm the handoff timer for this sub-session.
    this.clearHandoffTimer();
    this.handoffTimer = setTimeout(() => this.handoff(), HANDOFF_MS);
  }

  private handoff(): void {
    if (this.stopped || !this.current) return;
    const old = this.current;
    try {
      old.session.stopRecording(); // let it post-process; it stays in `subs`
    } catch {
      /* ignore */
    }
    // New sub-session picks up where this one left off (continuous timeline).
    this.startSubSession(this.elapsedMs);
  }

  private handleMessage(sub: SubSession, msg: LiveV2WebSocketMessage): void {
    switch (msg.type) {
      case 'transcript': {
        const utt = msg.data.utterance;
        const seg = this.utteranceToSegment(utt, msg.data.is_final, sub.baseOffsetMs);
        if (msg.data.is_final) {
          recordTranscript(sub.acc, msg.data);
          this.finalCb?.(seg);
        } else {
          this.partialCb?.(seg);
        }
        if (!this.langDetectedFired && msg.data.is_final && utt.language) {
          this.langDetectedFired = true;
          this.config.onLanguageDetected?.(utt.language);
        }
        break;
      }
      case 'named_entity_recognition':
        if (msg.data) recordNer(sub.acc, msg.data);
        break;
      case 'sentiment_analysis':
        if (msg.data) recordSentiment(sub.acc, msg.data);
        break;
      default:
        // start/stop acks, speech events, post_transcript, end_* — not needed:
        // the accumulator is already filled from the messages above.
        break;
    }
  }

  private utteranceToSegment(
    utt: LiveV2Utterance,
    isFinal: boolean,
    baseOffsetMs: number,
  ): TranscriptSegment {
    const twoChannel = (this.startOpts?.channels ?? 1) > 1;
    let channel: 0 | 1 = 1;
    let speakerLabel: string;
    if (twoChannel && utt.channel === 0) {
      // Legacy 2-channel path: mic channel is always the local user.
      channel = 0;
      speakerLabel = 'Me';
    } else {
      // Mono: everyone shares one channel; emit on "other" and let the IPC
      // layer's energy heuristic reassign the mic-dominant run to "Me".
      channel = 1;
      speakerLabel = typeof utt.speaker === 'number' ? `Speaker ${utt.speaker + 1}` : 'Speaker';
    }
    return {
      text: utt.text,
      channel,
      speakerLabel,
      startMs: utt.start * 1000 + baseOffsetMs,
      endMs: utt.end * 1000 + baseOffsetMs,
      isFinal,
    };
  }

  private maybeFinalize(): void {
    if (!this.stopped || this.insightsEmitted) return;
    if (this.subs.every((s) => s.ended)) this.finalize();
  }

  private finalize(): void {
    if (this.insightsEmitted) return;
    this.insightsEmitted = true;
    if (this.finalizeTimer) {
      clearTimeout(this.finalizeTimer);
      this.finalizeTimer = null;
    }
    const insights = normalizeGladia(
      this.subs.map((s) => ({ acc: s.acc, baseOffsetMs: s.baseOffsetMs })),
    );
    this.config.onStatus?.({ state: 'closed' });
    try {
      this.insightsCb?.(insights);
    } finally {
      for (const sub of this.subs) {
        try {
          sub.session.removeAllListeners();
        } catch {
          /* ignore */
        }
      }
      this.current = null;
    }
  }

  private clearHandoffTimer(): void {
    if (this.handoffTimer) {
      clearTimeout(this.handoffTimer);
      this.handoffTimer = null;
    }
  }
}
