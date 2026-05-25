// Dual-source capture pipeline for M1.
//
//   mic  (getUserMedia)        -> AudioWorklet input 0  -> channel 0 ("Me")
//   sys  (getDisplayMedia loopback, video discarded) -> input 1 -> channel 1 ("Others")
//
// The AudioContext is forced to 16 kHz so the browser handles resampling and the
// worklet only has to frame/interleave. Frames + per-channel levels are handed to
// the caller via onFrame. NO AUDIO IS PERSISTED — stop() drops everything.

export type CaptureState = 'idle' | 'starting' | 'running' | 'stopping';

export type CaptureFrame = {
  pcm: ArrayBuffer; // interleaved 16-bit PCM, ch0 = mic, ch1 = system
  micLevel: number; // 0..1 RMS
  sysLevel: number; // 0..1 RMS
  samplesPerChannel: number;
};

export type CaptureHandlers = {
  onFrame?: (f: CaptureFrame) => void;
  onError?: (e: Error) => void;
  onState?: (s: CaptureState) => void;
};

const WORKLET_URL = '/pcm-framer.worklet.js'; // served from renderer/public

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

  private setState(s: CaptureState): void {
    this.state = s;
    this.handlers.onState?.(s);
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.setState('starting');
    try {
      // 1) Microphone. Disable processing so channel 0 is a clean local signal.
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
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

      // 3) 16 kHz context => browser resamples both inputs; no manual resampler.
      this.ctx = new AudioContext({ sampleRate: 16000 });
      if (this.ctx.sampleRate !== 16000) {
        // Rare: some drivers refuse arbitrary rates. M2 would add a fallback
        // resampler in the worklet. Surface it rather than producing bad PCM.
        console.warn(`AudioContext rate is ${this.ctx.sampleRate}, expected 16000.`);
      }
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
        const d = ev.data;
        if (d?.type === 'frame') {
          this.handlers.onFrame?.({
            pcm: d.pcm,
            micLevel: d.micLevel,
            sysLevel: d.sysLevel,
            samplesPerChannel: d.samplesPerChannel,
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
