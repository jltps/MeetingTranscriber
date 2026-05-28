import WebSocket from 'ws';
import type { LanguageSetting, TranscriptSegment } from '../../shared/types';
import type { TranscriptionSession } from './session';
import type { TranscriptionStatus } from '../../shared/ipc-contract';
import { parseDeepgramMessage, parseDeepgramWords, type DeepgramWordView } from './parse';

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';

// Maximum cumulative byte size of buffered PCM during a reconnect gap.
// ~2 MB ≈ 30 s of 16 kHz 2-channel linear16 audio. Oldest chunks are dropped
// when the cap is exceeded — buffer stays RAM-only, never touches disk (§1.1).
const RECONNECT_BUFFER_MAX_BYTES = 2 * 1024 * 1024;

// Exponential backoff delays (ms) for reconnect attempts.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

export type DeepgramConfig = {
  apiKey: string;
  /**
   * Structured language setting (FEATURES §A). Resolved into query params by
   * buildDeepgramQuery(): 'auto' → `language=multi`; 'fixed' → the BCP-47 code.
   * NOTE: nova-3 streaming has no `detect_language` (it returns HTTP 400), so auto
   * mode uses `multi` — nova-3's multilingual/code-switching mode.
   */
  languageSetting?: LanguageSetting;
  /** Called once when the first detected_language is returned by Deepgram. */
  onLanguageDetected?: (bcp47: string) => void;
  /**
   * Called whenever the connection state changes: open / closed / error / reconnecting.
   * This supersedes the old onOpen / onClose / onError callbacks.
   */
  onStatus?: (status: TranscriptionStatus) => void;
};

// Build the Deepgram streaming query string. Pure + exported so the param rules can
// be unit-tested without opening a socket (they are easy to get subtly wrong — see
// V05, where detect_language silently broke nova-3 streaming with HTTP 400).
//
// nova-3 streaming language rules (developers.deepgram.com/docs):
//   - `detect_language` is NOT supported on streaming — using it returns HTTP 400.
//   - auto → `language=multi` (nova-3's multilingual / code-switching mode).
//   - fixed → the BCP-47 code directly (nova-3 accepts en + pt-PT/pt-BR/es/fr/de/… + multi).
export function buildDeepgramQuery(
  opts: { sampleRate: number; channels: number },
  languageSetting?: LanguageSetting,
): URLSearchParams {
  const params = new URLSearchParams({
    model: 'nova-3',
    // diarize splits multiple speakers *within* a channel. Two remote people share
    // one audio stream, so only diarization (not channel-splitting) can separate
    // them. Required in both the mono (V05) and legacy multichannel paths.
    diarize: 'true',
    // smart_format adds number/date/entity formatting on top of punctuation.
    smart_format: 'true',
    punctuate: 'true',
    interim_results: 'true',
    encoding: 'linear16',
    sample_rate: String(opts.sampleRate),
    channels: String(opts.channels),
  });
  // V05 ROADMAP_02: the renderer sends one mono channel to halve cost. multichannel
  // is only for the legacy ≥2-channel path (kept working for safety).
  if (opts.channels > 1) params.set('multichannel', 'true');

  const setting = languageSetting ?? { mode: 'fixed', bcp47: 'en' };
  params.set('language', setting.mode === 'auto' ? 'multi' : setting.bcp47);
  return params;
}

// Lightweight key check used by Settings → "Test connection". Hits a cheap REST
// endpoint; throws on any non-2xx so the caller can surface the failure.
export async function testDeepgramKey(apiKey: string): Promise<void> {
  const res = await fetch('https://api.deepgram.com/v1/projects', {
    headers: { Authorization: `Token ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Deepgram rejected the key (HTTP ${res.status}).`);
}

// Deepgram streaming over a WebSocket opened in the main process. The interleaved
// 16-bit PCM frames the renderer captures are linear16 multichannel exactly as
// Deepgram wants; we enable multichannel + diarization (PRODUCT_SPEC.md §6.3).
//
// Reconnect behaviour: on an unexpected close the session auto-reconnects with
// exponential backoff. PCM frames arriving during the gap are buffered in RAM
// (bounded at RECONNECT_BUFFER_MAX_BYTES) and flushed on reconnect. After
// BACKOFF_MS.length failed attempts the session enters an unrecoverable error
// state and the partial transcript (already persisted by the IPC layer) is kept.
export class DeepgramSession implements TranscriptionSession {
  private ws: WebSocket | null = null;
  private partialCb: ((seg: TranscriptSegment) => void) | null = null;
  private finalCb: ((seg: TranscriptSegment) => void) | null = null;
  private wordsCb: ((words: DeepgramWordView[]) => void) | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  /** Guard — fires onLanguageDetected only once per session. */
  private langDetectedFired = false;

  /** Set to true by stop() so the close handler skips reconnect. */
  private stopped = false;

  /** Parameters from the last start() call, needed for reconnect. */
  private startOpts: { sampleRate: number; channels: number } | null = null;

  /**
   * PCM chunks queued while the socket is down.
   * Each entry is the raw bytes from a pushAudio() call.
   * Total size is bounded by RECONNECT_BUFFER_MAX_BYTES.
   */
  private reconnectBuffer: Buffer[] = [];
  private reconnectBufferBytes = 0;

  constructor(private config: DeepgramConfig) {}

  onPartial(cb: (seg: TranscriptSegment) => void): void {
    this.partialCb = cb;
  }

  onFinal(cb: (seg: TranscriptSegment) => void): void {
    this.finalCb = cb;
  }

  onWords(cb: (words: DeepgramWordView[]) => void): void {
    this.wordsCb = cb;
  }

  pushAudio(pcm: Int16Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    } else if (!this.stopped) {
      // Socket is temporarily down — buffer in RAM only.
      const chunk = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      this.enqueueToReconnectBuffer(chunk);
    }
  }

  start(opts: { sampleRate: number; channels: number }): Promise<void> {
    if (!this.config.apiKey) {
      return Promise.reject(
        new Error('Deepgram API key not set. Set DEEPGRAM_API_KEY (env or .env) before starting.'),
      );
    }
    this.startOpts = opts;
    this.stopped = false;
    return this.openSocket(opts);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearKeepAlive();
    this.reconnectBuffer = [];
    this.reconnectBufferBytes = 0;
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
    } catch {
      /* socket already gone */
    }
    ws.close();
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Open (or re-open) a WebSocket connection with the given audio parameters. */
  private openSocket(opts: { sampleRate: number; channels: number }): Promise<void> {
    const params = buildDeepgramQuery(opts, this.config.languageSetting);

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${DEEPGRAM_URL}?${params.toString()}`, {
        headers: { Authorization: `Token ${this.config.apiKey}` },
      });
      this.ws = ws;

      ws.on('open', () => {
        this.config.onStatus?.({ state: 'open' });
        // Deepgram closes idle sockets; nudge it during silence.
        this.keepAlive = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }, 8000);
        // Flush buffered PCM from the reconnect gap.
        this.flushReconnectBuffer();
        resolve();
      });

      ws.on('message', (data: WebSocket.RawData) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          return;
        }
        // When language=multi, nova-3 returns a detected_language field on results.
        // Fire onLanguageDetected exactly once per session.
        if (
          !this.langDetectedFired &&
          this.config.onLanguageDetected &&
          typeof parsed === 'object' &&
          parsed !== null &&
          'channel' in parsed
        ) {
          const result = parsed as Record<string, unknown>;
          const detected =
            typeof result['detected_language'] === 'string'
              ? result['detected_language']
              : null;
          if (detected) {
            this.langDetectedFired = true;
            this.config.onLanguageDetected(detected);
          }
        }
        // V062 ROADMAP_01: single-channel finals route through the per-word path so
        // own-voice doesn't get scattered across Deepgram speaker IDs. The IPC layer
        // owns the energy timeline and does attribution + regrouping there. Interim
        // results and the legacy 2-channel path keep using parseDeepgramMessage.
        if (opts.channels === 1 && this.wordsCb) {
          const { words, isFinal } = parseDeepgramWords(parsed);
          if (isFinal && words.length > 0) {
            this.wordsCb(words);
            return;
          }
        }
        for (const seg of parseDeepgramMessage(parsed, { singleChannel: opts.channels === 1 })) {
          if (seg.isFinal) this.finalCb?.(seg);
          else this.partialCb?.(seg);
        }
      });

      ws.on('unexpected-response', (_req, res) => {
        const error = new Error(
          `Deepgram rejected the connection (HTTP ${res.statusCode ?? '?'}) — check the API key.`,
        );
        this.config.onStatus?.({ state: 'error', message: error.message });
        reject(error);
      });

      ws.on('error', (err: Error) => {
        // Don't fire onStatus here — the 'close' event follows immediately and
        // either drives the reconnect loop or fires the final error status.
        reject(err);
      });

      ws.on('close', () => {
        this.clearKeepAlive();
        if (this.stopped) {
          // Intentional stop — notify closed and exit.
          this.config.onStatus?.({ state: 'closed' });
          return;
        }
        // Unexpected close — attempt to reconnect.
        void this.scheduleReconnect(0);
      });
    });
  }

  /**
   * Exponential-backoff reconnect loop. `attempt` is 0-based index into BACKOFF_MS.
   * On each attempt fires `onStatus({ state: 'reconnecting' })`.
   * On exhaustion fires `onStatus({ state: 'error' })` and discards the buffer.
   */
  private async scheduleReconnect(attempt: number): Promise<void> {
    if (this.stopped) return;

    if (attempt >= BACKOFF_MS.length) {
      // All attempts exhausted — surface as unrecoverable error.
      this.reconnectBuffer = [];
      this.reconnectBufferBytes = 0;
      const msg = 'Transcription connection lost. The partial transcript has been saved.';
      this.config.onStatus?.({ state: 'error', message: msg });
      return;
    }

    const delay = BACKOFF_MS[attempt];
    const humanAttempt = attempt + 1;
    const total = BACKOFF_MS.length;
    this.config.onStatus?.({
      state: 'reconnecting',
      message: `Reconnecting… (attempt ${humanAttempt} of ${total})`,
    });

    await sleep(delay);
    if (this.stopped) return;

    try {
      await this.openSocket(this.startOpts!);
      // Success — openSocket resolves after 'open' fires (which also flushes buffer).
    } catch {
      // Failed — try next backoff step.
      await this.scheduleReconnect(attempt + 1);
    }
  }

  /** Flush the reconnect buffer into the open socket. */
  private flushReconnectBuffer(): void {
    if (this.reconnectBuffer.length === 0) return;
    const chunks = this.reconnectBuffer;
    this.reconnectBuffer = [];
    this.reconnectBufferBytes = 0;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const chunk of chunks) {
      try {
        this.ws.send(chunk);
      } catch {
        /* socket gone mid-flush — acceptable; partial flush is better than none */
        break;
      }
    }
  }

  /** Append a chunk to the reconnect buffer, evicting oldest if over cap. */
  private enqueueToReconnectBuffer(chunk: Buffer): void {
    this.reconnectBuffer.push(chunk);
    this.reconnectBufferBytes += chunk.byteLength;
    // Evict oldest chunks until we're back under the cap.
    while (this.reconnectBufferBytes > RECONNECT_BUFFER_MAX_BYTES && this.reconnectBuffer.length > 0) {
      const evicted = this.reconnectBuffer.shift();
      if (evicted) this.reconnectBufferBytes -= evicted.byteLength;
    }
  }

  private clearKeepAlive(): void {
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
