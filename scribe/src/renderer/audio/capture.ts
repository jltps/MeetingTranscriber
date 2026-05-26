// Dual-source capture pipeline for M1 (PRODUCT_SPEC.md §6.1, §6.3).
//
//   mic (getUserMedia)                              -> worklet input 0 -> channel 0 ("Me")
//   sys (getDisplayMedia loopback, video discarded) -> worklet input 1 -> channel 1 ("Others")
//
// The AudioContext is forced to 16 kHz so the browser handles resampling and the
// worklet only frames/interleaves. Frames + per-channel levels are handed to the
// caller via onFrame. NO AUDIO IS PERSISTED — stop() drops everything (§1.1, §6.4).

export type CaptureState = 'idle' | 'starting' | 'running' | 'stopping';

export type CaptureFrame = {
  pcm: ArrayBuffer; // interleaved 16-bit PCM, ch0 = mic, ch1 = system
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

export type CaptureHandlers = {
  onFrame?: (frame: CaptureFrame) => void;
  onError?: (error: Error) => void;
  onState?: (state: CaptureState) => void;
  // The AudioContext's actual rate. Surfaced because rare drivers refuse 16 kHz;
  // the UI warns rather than letting bad PCM flow (M2 adds a fallback resampler).
  onReady?: (info: { sampleRate: number }) => void;
  // Diagnostics for the loopback track. If this reports live + unmuted but CH1
  // stays flat, the captured output endpoint is silent (device/routing issue),
  // not a capture bug.
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
// packaged app (file:// origin). An absolute '/' path would resolve to the
// filesystem root in file:// context, causing addModule() to fail with AbortError.
const WORKLET_URL = './pcm-framer.worklet.js';

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
      // 1) Microphone. Disable processing so channel 0 is a clean local signal.
      //    Use the device chosen in Settings (§10); otherwise the OS default.
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: opts.micDeviceId ? { exact: opts.micDeviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      // 2) System / loopback audio. We must request video (Chromium constraint);
      //    the main process supplies a screen source + 'loopback' audio. Discard
      //    the video track immediately — we only want the system audio.
      this.sysStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });
      this.sysStream.getVideoTracks().forEach((t) => t.stop());
      if (this.sysStream.getAudioTracks().length === 0) {
        throw new Error('No system audio track — loopback capture was not granted.');
      }

      // Report the loopback track's state so the UI can distinguish "silent
      // endpoint" from "no track at all". muted flips when the source delivers
      // silence; we re-report on mute/unmute.
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

      // 3) 16 kHz context => browser resamples both inputs; no manual resampler.
      this.ctx = new AudioContext({ sampleRate: 16000 });
      this.handlers.onReady?.({ sampleRate: this.ctx.sampleRate });
      await this.ctx.audioWorklet.addModule(WORKLET_URL);

      // 4) Two-input, zero-output worklet. channelCount:1 forces each input mono.
      this.node = new AudioWorkletNode(this.ctx, 'pcm-framer', {
        numberOfInputs: 2,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
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
