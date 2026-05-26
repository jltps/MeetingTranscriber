import WebSocket from 'ws';
import type { TranscriptSegment } from '../../shared/types';
import type { TranscriptionSession } from './session';
import { parseDeepgramMessage } from './parse';

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';

export type DeepgramConfig = {
  apiKey: string;
  language?: string; // 'auto' enables detection; otherwise a language code like 'en'
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
      diarize: 'true',
      punctuate: 'true',
      interim_results: 'true',
      encoding: 'linear16',
      sample_rate: String(opts.sampleRate),
      channels: String(opts.channels),
    });
    const language = this.config.language ?? 'en';
    if (language === 'auto') params.set('detect_language', 'true');
    else params.set('language', language);

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
