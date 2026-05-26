/**
 * Local Whisper transcription session (ROADMAP_05).
 *
 * Implements the same TranscriptionSession interface as DeepgramSession so the
 * factory in index.ts can switch providers without touching IPC or renderer code.
 *
 * Audio processing model:
 *   - 5-second chunks at 16 kHz = 80,000 samples per channel per chunk
 *   - Deinterleaved in memory: Int16 2-ch → Float32 ch0 (Me) + Float32 ch1 (Speaker 1)
 *   - Silent chunks (RMS < 0.001) are skipped — no Whisper call, no result
 *   - Channels processed sequentially to avoid CPU thrashing
 *   - Whisper is batch-only (30-s context window), so latency ≈ chunk size (5 s)
 *
 * §1.1 invariant: audio is NEVER written to disk. Float32Arrays live only in heap
 * memory and are GC'd after each inference call.
 */
import type { TranscriptSegment } from '../../shared/types';
import type { TranscriptionSession } from './session';
import type { TranscriptionStatus } from '../../shared/ipc-contract';
import type { LanguageSetting } from '../../shared/types';
import { getHfId, isModelDownloaded, loadTransformers } from './whisper-models';
import type { WhisperModelName } from './whisper-models';
import { logger } from '../logger';

// 5 seconds of 16 kHz mono audio.
const CHUNK_SAMPLES = 16_000 * 5;
/** RMS below this threshold → treat the chunk as silence and skip inference. */
const SILENCE_RMS = 0.001;

// ── Whisper inference adapter ─────────────────────────────────────────────────

type InferResult = { text: string; detectedLanguage?: string };

/**
 * Run Whisper inference on an in-memory Float32Array.
 * Uses @xenova/transformers ASR pipeline — no file I/O (§1.1).
 *
 * The pipeline instance is cached in the module to avoid re-loading ONNX on
 * every chunk. On first call it loads the model from the local cache
 * (getModelsDir()) which takes a few seconds; subsequent calls are fast.
 */
let cachedModelName: WhisperModelName | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedPipeline: any | null = null;

async function getOrLoadPipeline(modelName: WhisperModelName): Promise<unknown> {
  if (cachedPipeline && cachedModelName === modelName) return cachedPipeline;
  // Lazy-load to avoid loading the ONNX runtime until it is actually needed,
  // and to keep the ESM-only package off the static require() path.
  const { pipeline } = await loadTransformers();
  const hfId = getHfId(modelName);
  logger.info(`Loading Whisper pipeline for model "${modelName}" (${hfId})`);
  cachedPipeline = await pipeline('automatic-speech-recognition', hfId);
  cachedModelName = modelName;
  logger.info(`Whisper pipeline loaded for model "${modelName}"`);
  return cachedPipeline;
}

async function inferWhisper(
  audio: Float32Array,
  opts: { modelName: WhisperModelName; language?: string },
): Promise<InferResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipe = (await getOrLoadPipeline(opts.modelName)) as any;

  const whisperOpts: Record<string, unknown> = {
    task: 'transcribe',
    return_timestamps: false,
    chunk_length_s: 30,
  };
  if (opts.language) {
    // @xenova/transformers accepts the BCP-47 code (e.g. 'pt', 'en', 'pt-PT')
    // as well as the full English name. Pass through whatever we have.
    whisperOpts.language = opts.language;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (await pipe(audio, whisperOpts)) as any;

  const text: string = result?.text ?? '';
  // @xenova/transformers may surface `language` on the result object
  const detectedLanguage: string | undefined = result?.language ?? undefined;

  return { text, detectedLanguage };
}

// ── WhisperSession ────────────────────────────────────────────────────────────

export class WhisperSession implements TranscriptionSession {
  // Per-channel Float32 sample buffers — heap only, never written to disk (§1.1).
  private buf0: Float32Array[] = [];
  private buf0Len = 0;
  private buf1: Float32Array[] = [];
  private buf1Len = 0;

  private processing = false;
  private langFired = false;
  private sessionStartMs = 0;
  private stopped = false;

  private finalCb?: (seg: TranscriptSegment) => void;

  constructor(
    private readonly modelName: WhisperModelName,
    private readonly languageSetting: LanguageSetting,
    private readonly onLanguageDetected?: (bcp47: string) => void,
    private readonly onStatus?: (s: TranscriptionStatus) => void,
  ) {}

  async start(opts: { sampleRate: number; channels: number }): Promise<void> {
    if (!isModelDownloaded(this.modelName)) {
      throw new Error(
        `Whisper model "${this.modelName}" is not downloaded. Download it in Settings → Transcription.`,
      );
    }
    this.sessionStartMs = Date.now();
    this.stopped = false;
    this.langFired = false;
    this.buf0 = [];
    this.buf0Len = 0;
    this.buf1 = [];
    this.buf1Len = 0;
    logger.info(
      `WhisperSession starting with model="${this.modelName}" sampleRate=${opts.sampleRate} channels=${opts.channels}`,
    );
    this.onStatus?.({ state: 'open' });
  }

  /**
   * Receive interleaved 2-channel Int16 PCM (16 kHz, Me=ch0, Speaker=ch1).
   * Deinterleaves into two mono Float32 buffers. When a buffer reaches
   * CHUNK_SAMPLES, schedules inference for both channels.
   */
  pushAudio(pcm: Int16Array): void {
    if (this.stopped) return;

    const n = Math.floor(pcm.length / 2);
    const ch0 = new Float32Array(n);
    const ch1 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Normalize Int16 → Float32 in [-1, 1]. Stays in RAM, never touches disk.
      ch0[i] = pcm[i * 2] / 32768.0;
      ch1[i] = pcm[i * 2 + 1] / 32768.0;
    }

    this.buf0.push(ch0);
    this.buf0Len += n;
    this.buf1.push(ch1);
    this.buf1Len += n;

    if (this.buf0Len >= CHUNK_SAMPLES && !this.processing) {
      void this.processChunk();
    }
  }

  private async processChunk(): Promise<void> {
    this.processing = true;
    const audio0 = this.drainChannel(this.buf0);
    const audio1 = this.drainChannel(this.buf1);
    this.buf0 = [];
    this.buf0Len = 0;
    this.buf1 = [];
    this.buf1Len = 0;

    try {
      // Sequential to avoid CPU thrashing: ch0 then ch1.
      await this.transcribeAndEmit(audio0, 'Me', 0);
      if (!this.stopped) {
        await this.transcribeAndEmit(audio1, 'Speaker 1', 1);
      }
    } catch (err) {
      logger.error('Whisper inference error', err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.processing = false;
      // If more audio accumulated while we were processing, run again.
      if (!this.stopped && this.buf0Len >= CHUNK_SAMPLES) {
        void this.processChunk();
      }
    }
  }

  private drainChannel(chunks: Float32Array[]): Float32Array {
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  private async transcribeAndEmit(
    audio: Float32Array,
    speakerLabel: string,
    channel: 0 | 1,
  ): Promise<void> {
    // Skip silent audio to avoid hallucinations and unnecessary inference.
    const rms = Math.sqrt(audio.reduce((s, x) => s + x * x, 0) / audio.length);
    if (rms < SILENCE_RMS) return;

    const language =
      this.languageSetting.mode === 'fixed' ? this.languageSetting.bcp47 : undefined;

    const result = await inferWhisper(audio, { modelName: this.modelName, language });
    if (!result.text.trim()) return;

    if (!this.langFired && result.detectedLanguage) {
      this.langFired = true;
      this.onLanguageDetected?.(result.detectedLanguage);
    }

    const endMs = Date.now() - this.sessionStartMs;
    const durationMs = (audio.length / 16_000) * 1_000;

    const seg: TranscriptSegment = {
      text: result.text.trim(),
      channel,
      speakerLabel,
      startMs: Math.max(0, endMs - durationMs),
      endMs,
      isFinal: true,
    };

    this.finalCb?.(seg);
  }

  // Whisper is batch-only; partials are never emitted. Accept the callback to
  // satisfy the TranscriptionSession interface but discard it.
  onPartial(_cb: (seg: TranscriptSegment) => void): void { /* no-op */ }

  onFinal(cb: (seg: TranscriptSegment) => void): void {
    this.finalCb = cb;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    // Wait briefly for any in-flight inference to finish so we don't orphan it.
    if (this.processing) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!this.processing) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    }
    this.buf0 = [];
    this.buf0Len = 0;
    this.buf1 = [];
    this.buf1Len = 0;
    this.onStatus?.({ state: 'closed' });
    logger.info('WhisperSession stopped');
  }
}
