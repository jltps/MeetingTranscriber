// Dual-source capture pipeline (PRODUCT_SPEC.md §6.1, §6.3; V073 hardening).
//
//   mic (getUserMedia)                              -> worklet input 0
//   sys (getDisplayMedia loopback, video discarded) -> worklet input 1
//
// V073: the AudioContext is no longer forced to 16 kHz — some WASAPI endpoints
// (Bluetooth A2DP, certain Realtek drivers) silently refuse the request and the
// context comes up at 44.1/48 kHz, which used to ship PCM at the wrong rate. We
// now read the actual rate after construction and tell the worklet to decimate
// to 16 kHz before posting frames. Mic acquisition also has a layered fallback
// (exact → ideal → system default) so a stale stored deviceId can no longer
// silently fail. NO AUDIO IS PERSISTED — stop() drops everything (§1.1, §6.4).

export type CaptureState = 'idle' | 'starting' | 'running' | 'stopping';

export type CaptureFrame = {
  pcm: ArrayBuffer; // mono 16-bit PCM @ 16 kHz (worklet decimates if needed)
  micLevel: number; // 0..1 RMS
  sysLevel: number; // 0..1 RMS
  samplesPerChannel: number;
};

export type SysTrackInfo = {
  label: string;
  readyState: MediaStreamTrackState; // 'live' | 'ended'
  muted: boolean; // true => the source is delivering silence right now
  enabled: boolean;
};

/** Which fallback step the mic acquisition ended up on. */
export type MicFallbackStep = 'exact' | 'ideal' | 'system-default';

export type CaptureHandlers = {
  onFrame?: (frame: CaptureFrame) => void;
  onError?: (error: Error) => void;
  onState?: (state: CaptureState) => void;
  // The AudioContext's actual rate + the requested mic device fallback step.
  // Surfaced for diagnostics and so the UI can warn when a stored deviceId was
  // stale and we fell back to the system default.
  onReady?: (info: { sampleRate: number; micFallbackStep: MicFallbackStep }) => void;
  onSysTrack?: (info: SysTrackInfo) => void;
};

type WorkletFrameMessage = {
  type: 'frame';
  pcm: ArrayBuffer;
  micLevel: number;
  sysLevel: number;
  samplesPerChannel: number;
};

// Relative so it resolves correctly in both dev (Vite dev server) and the
// packaged app (file:// origin).
const WORKLET_URL = './pcm-framer.worklet.js';

/** Typed capture error so the UI can surface a useful message per failure mode. */
export type CaptureErrorKind =
  | 'mic-unavailable' // no acceptable mic on any fallback step
  | 'loopback-denied' // getDisplayMedia rejected (e.g. main handler returned {})
  | 'no-system-audio'; // loopback granted but the track is missing
export class CaptureError extends Error {
  constructor(public kind: CaptureErrorKind, message: string, public override cause?: unknown) {
    super(message);
    this.name = 'CaptureError';
  }
}

/**
 * Acquire a mic stream with a layered fallback chain so a stale stored deviceId
 * (Bluetooth headset that reconnected with a different id, USB device replugged,
 * etc.) never silently fails. Returns the stream and which step succeeded.
 */
export async function acquireMicStream(
  deviceId: string | undefined,
): Promise<{ stream: MediaStream; step: MicFallbackStep }> {
  const baseAudio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  } as const;
  const attempts: Array<{ step: MicFallbackStep; constraints: MediaStreamConstraints }> = [];
  if (deviceId) {
    attempts.push({
      step: 'exact',
      constraints: { audio: { ...baseAudio, deviceId: { exact: deviceId } }, video: false },
    });
    attempts.push({
      step: 'ideal',
      constraints: { audio: { ...baseAudio, deviceId: { ideal: deviceId } }, video: false },
    });
  }
  attempts.push({
    step: 'system-default',
    constraints: { audio: baseAudio, video: false },
  });
  let lastErr: unknown = null;
  for (const a of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(a.constraints);
      return { stream, step: a.step };
    } catch (err) {
      lastErr = err;
      // Try the next fallback step.
    }
  }
  throw new CaptureError(
    'mic-unavailable',
    'No usable microphone — check that your device is plugged in and that Windows allows app mic access.',
    lastErr,
  );
}

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private sysStream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private micSrc: MediaStreamAudioSourceNode | null = null;
  private sysSrc: MediaStreamAudioSourceNode | null = null;
  private state: CaptureState = 'idle';

  constructor(private handlers: CaptureHandlers = {}) {}

  getState(): CaptureState {
    return this.state;
  }

  private setState(state: CaptureState): void {
    this.state = state;
    this.handlers.onState?.(state);
  }

  async start(opts: { micDeviceId?: string } = {}): Promise<void> {
    if (this.state !== 'idle') return;
    this.setState('starting');
    try {
      // 1) Microphone with fallback chain (V073 block 01.1). Mic processing
      //    stays disabled so channel 0 is a clean local signal.
      const { stream: micStream, step: micFallbackStep } = await acquireMicStream(
        opts.micDeviceId,
      );
      this.micStream = micStream;

      // 2) System / loopback audio. Chromium normally requires a video source
      //    alongside the loopback audio; the main process supplies one if it
      //    can. On hosts where no screen source exists (V073 block 01.2 path:
      //    RDP / HDMI-only) main returns audio-only and Chromium accepts it.
      try {
        this.sysStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });
      } catch (err) {
        throw new CaptureError(
          'loopback-denied',
          'System audio (loopback) was not granted. Open the app from your own desktop session and check Windows Sound settings.',
          err,
        );
      }
      this.sysStream.getVideoTracks().forEach((t) => t.stop());
      if (this.sysStream.getAudioTracks().length === 0) {
        throw new CaptureError(
          'no-system-audio',
          'No system audio track — Windows did not expose a loopback endpoint. Make sure an output device is set as default and not muted.',
        );
      }

      const sysTrack = this.sysStream.getAudioTracks()[0];
      const reportSysTrack = (): void =>
        this.handlers.onSysTrack?.({
          label: sysTrack.label,
          readyState: sysTrack.readyState,
          muted: sysTrack.muted,
          enabled: sysTrack.enabled,
        });
      reportSysTrack();
      sysTrack.onmute = reportSysTrack;
      sysTrack.onunmute = reportSysTrack;

      // 3) AudioContext without a forced sample rate (V073 block 01.3). Some
      //    WASAPI endpoints silently refuse 16 kHz and come up at 44.1/48 kHz;
      //    we read the actual rate and tell the worklet to decimate. Speech is
      //    band-limited so linear interpolation in the worklet is acceptable.
      this.ctx = new AudioContext();
      const ctxRate = this.ctx.sampleRate;
      this.handlers.onReady?.({ sampleRate: ctxRate, micFallbackStep });
      await this.ctx.audioWorklet.addModule(WORKLET_URL);

      // 4) Two-input, zero-output worklet. channelCount:1 forces each input mono.
      this.node = new AudioWorkletNode(this.ctx, 'pcm-framer', {
        numberOfInputs: 2,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        processorOptions: { sourceRate: ctxRate, targetRate: 16000 },
      });
      this.node.port.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as WorkletFrameMessage;
        if (msg.type === 'frame') {
          this.handlers.onFrame?.({
            pcm: msg.pcm,
            micLevel: msg.micLevel,
            sysLevel: msg.sysLevel,
            samplesPerChannel: msg.samplesPerChannel,
          });
        }
      };

      this.micSrc = this.ctx.createMediaStreamSource(this.micStream);
      this.sysSrc = this.ctx.createMediaStreamSource(this.sysStream);
      this.micSrc.connect(this.node, 0, 0); // mic    -> input 0
      this.sysSrc.connect(this.node, 0, 1); // system -> input 1

      // If the OS/user stops the system-audio share, tear down cleanly.
      this.sysStream.getAudioTracks().forEach((t) => {
        t.onended = () => void this.stop();
      });

      await this.ctx.resume();
      this.setState('running');
    } catch (err) {
      this.handlers.onError?.(err as Error);
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.setState('stopping');
    try {
      this.micSrc?.disconnect();
    } catch {
      /* noop */
    }
    try {
      this.sysSrc?.disconnect();
    } catch {
      /* noop */
    }
    if (this.node) {
      this.node.port.onmessage = null;
      try {
        this.node.disconnect();
      } catch {
        /* noop */
      }
    }
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.sysStream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        await this.ctx.close();
      } catch {
        /* noop */
      }
    }
    this.micSrc = null;
    this.sysSrc = null;
    this.node = null;
    this.micStream = null;
    this.sysStream = null;
    this.ctx = null;
    this.setState('idle');
  }
}

// ─── Pre-flight capture probe (V073 block 01.4) ──────────────────────────────

/** Result of a brief capture probe — used by the pre-flight dialog + Settings. */
export type CaptureProbeResult = {
  micRmsPeak: number;
  sysRmsPeak: number;
  micFrames: number;
  sysFrames: number;
  sampleRate: number;
  sysMuted: boolean;
  micFallbackStep: MicFallbackStep;
  error?: string;
};

/**
 * Spin up capture for ~1500 ms, observe whether mic + loopback are actually
 * producing signal, then tear down. Used to surface silent-failure modes
 * (stale device id, muted loopback, non-default output endpoint) before the
 * user starts a real meeting. All audio is discarded; no IPC, no transcription.
 */
export async function runCaptureProbe(
  opts: { micDeviceId?: string; durationMs?: number } = {},
): Promise<CaptureProbeResult> {
  const duration = opts.durationMs ?? 1500;
  let micRmsPeak = 0;
  let sysRmsPeak = 0;
  let micFrames = 0;
  let sysFrames = 0;
  let sampleRate = 0;
  let sysMuted = false;
  let micFallbackStep: MicFallbackStep = 'system-default';
  let error: string | undefined;

  const capture = new AudioCapture({
    onFrame: (f) => {
      if (f.micLevel > 0.001) {
        micRmsPeak = Math.max(micRmsPeak, f.micLevel);
        micFrames++;
      }
      if (f.sysLevel > 0.001) {
        sysRmsPeak = Math.max(sysRmsPeak, f.sysLevel);
        sysFrames++;
      }
    },
    onReady: (info) => {
      sampleRate = info.sampleRate;
      micFallbackStep = info.micFallbackStep;
    },
    onSysTrack: (t) => {
      sysMuted = t.muted;
    },
    onError: (e) => {
      error = e instanceof CaptureError ? e.message : e.message;
    },
  });

  try {
    await capture.start({ micDeviceId: opts.micDeviceId });
    await new Promise<void>((resolve) => setTimeout(resolve, duration));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    await capture.stop();
  }
  return {
    micRmsPeak,
    sysRmsPeak,
    micFrames,
    sysFrames,
    sampleRate,
    sysMuted,
    micFallbackStep,
    error,
  };
}
