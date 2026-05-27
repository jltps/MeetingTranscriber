// Runs in AudioWorkletGlobalScope (plain JS, served from /public so no bundler
// gymnastics). The AudioContext is created at 16 kHz upstream, so there is NO
// resampling to do here — the browser already resampled both inputs. This
// processor only:
//   - reads input 0 (microphone)  and input 1 (system audio)
//   - DOWNMIXES them into a single mono 16-bit PCM channel  [s0, s1, s2, ...]
//     (V05 ROADMAP_02: Deepgram bills per channel, so one mono channel halves the
//     cost; speaker separation comes from diarization, and "Me" is recovered in the
//     main process from the per-frame mic/system RMS levels also posted below)
//   - frames to ~100 ms and posts each frame + per-channel RMS to the renderer
//
// The mic and system RMS levels are still computed separately and posted every
// frame — they drive the VU meters AND the main-process "Me" attribution. They are
// scalars, never audio bytes. Nothing is buffered beyond one in-flight frame; no
// audio is stored (§1.1).

const TARGET_RATE = 16000;
const FRAME_MS = 100;
const FRAME_SAMPLES = (TARGET_RATE * FRAME_MS) / 1000; // 1600 samples / channel

class PcmFramer extends AudioWorkletProcessor {
  constructor() {
    super();
    this._mic = new Float32Array(FRAME_SAMPLES);
    this._sys = new Float32Array(FRAME_SAMPLES);
    this._fill = 0;
  }

  process(inputs) {
    // Each input is an array of channels; channelCount:1 on the node makes them mono.
    const mic = inputs[0] && inputs[0][0];
    const sys = inputs[1] && inputs[1][0];
    const block = (mic && mic.length) || (sys && sys.length) || 0;
    if (!block) return true; // no audio this quantum; stay alive

    for (let i = 0; i < block; i++) {
      this._mic[this._fill] = mic ? mic[i] : 0;
      this._sys[this._fill] = sys ? sys[i] : 0;
      this._fill++;
      if (this._fill === FRAME_SAMPLES) {
        this._emit();
        this._fill = 0;
      }
    }
    return true;
  }

  _emit() {
    const out = new Int16Array(FRAME_SAMPLES); // single mono channel
    let micSum = 0;
    let sysSum = 0;
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      const m = this._mic[i];
      const s = this._sys[i];
      // Downmix: sum mic + system, clamped to [-1, 1]. Simultaneous full-scale
      // speech on both is rare, so clipping is negligible; summing (vs averaging)
      // preserves SNR, which matters more to the recognizer than occasional clip.
      const mix = Math.max(-1, Math.min(1, m + s));
      out[i] = mix < 0 ? mix * 0x8000 : mix * 0x7fff;
      micSum += m * m;
      sysSum += s * s;
    }
    this.port.postMessage(
      {
        type: 'frame',
        pcm: out.buffer,
        micLevel: Math.sqrt(micSum / FRAME_SAMPLES),
        sysLevel: Math.sqrt(sysSum / FRAME_SAMPLES),
        samplesPerChannel: FRAME_SAMPLES,
      },
      [out.buffer], // transfer (zero-copy); buffer is consumed and not retained
    );
  }
}

registerProcessor('pcm-framer', PcmFramer);
