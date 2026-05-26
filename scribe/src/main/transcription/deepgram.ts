import WebSocket from 'ws';
import type { LanguageSetting, TranscriptSegment } from '../../shared/types';
import type { TranscriptionSession } from './session';
import { parseDeepgramMessage } from './parse';

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';

export type DeepgramConfig = {
  apiKey: string;
  /**
   * Structured language setting (FEATURES §A).
   * 'auto' → nova-3 language=multi (multilingual, keeps multichannel).
   * 'fixed' → pass the BCP-47 code directly.
   * NOTE: Deepgram detect_language=true is incompatible with multichannel=true
   * (returns HTTP 400). We use language=multi instead, which lets nova-3 handle
   * multiple languages while preserving the multichannel Me/Them split.
   */
  languageSetting?: LanguageSetting;
  /** Called once when the first detected_language is returned by Deepgram. */
  onLanguageDetected?: (bcp47: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
};

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
export class DeepgramSession implements TranscriptionSession {
  private ws: WebSocket | null = null;
  private partialCb: ((seg: TranscriptSegment) => void) | null = null;
  private finalCb: ((seg: TranscriptSegment) => void) | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  /** Guard — fires onLanguageDetected only once per session. */
  private langDetectedFired = false;

  constructor(private config: DeepgramConfig) {}

  onPartial(cb: (seg: TranscriptSegment) => void): void {
    this.partialCb = cb;
  }

  onFinal(cb: (seg: TranscriptSegment) => void): void {
    this.finalCb = cb;
  }

  pushAudio(pcm: Int16Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    }
  }

  start(opts: { sampleRate: number; channels: number }): Promise<void> {
    if (!this.config.apiKey) {
      return Promise.reject(
        new Error('Deepgram API key not set. Set DEEPGRAM_API_KEY (env or .env) before starting.'),
      );
    }

    const params = new URLSearchParams({
      model: 'nova-3',
      multichannel: 'true',
      // diarize is for single-channel speaker separation and is incompatible with
      // multichannel mode. Channel 0 (mic) and channel 1 (loopback) already encode
      // "me vs them" attribution deterministically — no diarize needed.
      punctuate: 'true',
      interim_results: 'true',
      encoding: 'linear16',
      sample_rate: String(opts.sampleRate),
      channels: String(opts.channels),
    });
    const setting = this.config.languageSetting ?? { mode: 'fixed', bcp47: 'en' };
    if (setting.mode === 'auto') {
      // nova-3 language=multi enables multilingual transcription while keeping
      // multichannel. detect_language=true is incompatible with multichannel (HTTP 400).
      params.set('language', 'multi');
    } else {
      params.set('language', setting.bcp47);
    }
    this.langDetectedFired = false;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${DEEPGRAM_URL}?${params.toString()}`, {
        headers: { Authorization: `Token ${this.config.apiKey}` },
      });
      this.ws = ws;

      ws.on('open', () => {
        this.config.onOpen?.();
        // Deepgram closes idle sockets; nudge it during silence.
        this.keepAlive = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }, 8000);
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
        for (const seg of parseDeepgramMessage(parsed)) {
          if (seg.isFinal) this.finalCb?.(seg);
          else this.partialCb?.(seg);
        }
      });

      ws.on('unexpected-response', (_req, res) => {
        const error = new Error(
          `Deepgram rejected the connection (HTTP ${res.statusCode ?? '?'}) — check the API key.`,
        );
        this.config.onError?.(error);
        reject(error);
      });

      ws.on('error', (err: Error) => {
        this.config.onError?.(err);
        reject(err);
      });

      ws.on('close', () => {
        this.clearKeepAlive();
        this.config.onClose?.();
      });
    });
  }

  async stop(): Promise<void> {
    this.clearKeepAlive();
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

  private clearKeepAlive(): void {
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }
}
