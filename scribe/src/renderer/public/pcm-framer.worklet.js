// Runs in AudioWorkletGlobalScope (plain JS, served from /public so no bundler
// gymnastics). The AudioContext is created at the OS-preferred sample rate
// (V073 block 01.3 — used to be hard-pinned to 16 kHz, which some WASAPI
// endpoints silently refused). The processor reads `processorOptions`
// `{ sourceRate, targetRate }` and decimates to `targetRate` (16 kHz) before
// framing. Decimation is linear interpolation: voice is band-limited around
// 4 kHz so the artefacts are imperceptible to a speech recognizer.
//
// Pipeline per quantum:
//   - reads input 0 (microphone)  and input 1 (system audio)
//   - if sourceRate != targetRate, linearly resamples mic + sys to targetRate
//   - DOWNMIXES them into a single mono 16-bit PCM channel  [s0, s1, s2, ...]
//     (V05 ROADMAP_02: Deepgram bills per channel, so one mono channel halves
//     the cost; speaker separation comes from diarization, and "Me" is recovered
//     in main from the per-frame mic/system RMS levels posted below)
//   - frames to ~100 ms and posts each frame + per-channel RMS to the renderer
//
// The mic and system RMS levels drive the VU meters AND the main-process "Me"
// attribution. They are scalars, never audio bytes. Nothing is buffered beyond
// one in-flight frame; no audio is stored (§1.1).

const TARGET_RATE_DEFAULT = 16000;
const FRAME_MS = 100;

class PcmFramer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this._targetRate = o.targetRate || TARGET_RATE_DEFAULT;
    this._sourceRate = o.sourceRate || sampleRate; // AudioWorkletGlobalScope global
    this._ratio = this._sourceRate / this._targetRate; // source samples per output sample
    this._frameSamples = Math.round((this._targetRate * FRAME_MS) / 1000); // 1600 @ 16 kHz
    this._mic = new Float32Array(this._frameSamples);
    this._sys = new Float32Array(this._frameSamples);
    this._fill = 0;
    // Floating-point fractional position into the next source-rate sample.
    // Carries across `process` quanta so resampling is continuous.
    this._srcPos = 0;
    // One source-sample backlog for linear interp across quantum boundaries.
    this._lastMic = 0;
    this._lastSys = 0;
  }

  process(inputs) {
    // Each input is an array of channels; channelCount:1 on the node makes them mono.
    const mic = inputs[0] && inputs[0][0];
    const sys = inputs[1] && inputs[1][0];
    const block = (mic && mic.length) || (sys && sys.length) || 0;
    if (!block) return true; // no audio this quantum; stay alive

    const ratio = this._ratio;
    if (ratio === 1) {
      // Fast path: source rate matches target rate; pass through unchanged.
      for (let i = 0; i < block; i++) {
        this._mic[this._fill] = mic ? mic[i] : 0;
        this._sys[this._fill] = sys ? sys[i] : 0;
        this._fill++;
        if (this._fill === this._frameSamples) {
          this._emit();
          this._fill = 0;
        }
      }
      return true;
    }

    // Linear resample from sourceRate -> targetRate. _srcPos is the next
    // (fractional) source-sample index to read; we advance by `ratio` per
    // output sample. When _srcPos falls within this block, interpolate;
    // when it advances past `block`, we're done and store the carry.
    let pos = this._srcPos;
    while (pos < block) {
      const i0 = Math.floor(pos);
      const i1 = i0 + 1;
      const frac = pos - i0;
      const m0 = i0 < 0 ? this._lastMic : mic ? mic[i0] : 0;
      const m1 = i1 < block ? (mic ? mic[i1] : 0) : (mic ? mic[block - 1] : 0);
      const s0 = i0 < 0 ? this._lastSys : sys ? sys[i0] : 0;
      const s1 = i1 < block ? (sys ? sys[i1] : 0) : (sys ? sys[block - 1] : 0);
      this._mic[this._fill] = m0 + (m1 - m0) * frac;
      this._sys[this._fill] = s0 + (s1 - s0) * frac;
      this._fill++;
      if (this._fill === this._frameSamples) {
        this._emit();
        this._fill = 0;
      }
      pos += ratio;
    }
    // Carry: how far into the *next* quantum the read head landed. Subtracting
    // `block` is correct because the next quantum's samples start at index 0.
    this._srcPos = pos - block;
    if (mic) this._lastMic = mic[block - 1];
    if (sys) this._lastSys = sys[block - 1];
    return true;
  }

  _emit() {
    const N = this._frameSamples;
    const out = new Int16Array(N); // single mono channel
    let micSum = 0;
    let sysSum = 0;
    for (let i = 0; i < N; i++) {
      const m = this._mic[i];
      const s = this._sys[i];
      // Downmix: sum mic + system, clamped to [-1, 1].
      const mix = Math.max(-1, Math.min(1, m + s));
      out[i] = mix < 0 ? mix * 0x8000 : mix * 0x7fff;
      micSum += m * m;
      sysSum += s * s;
    }
    this.port.postMessage(
      {
        type: 'frame',
        pcm: out.buffer,
        micLevel: Math.sqrt(micSum / N),
        sysLevel: Math.sqrt(sysSum / N),
        samplesPerChannel: N,
      },
      [out.buffer], // transfer (zero-copy); buffer is consumed and not retained
    );
  }
}

registerProcessor('pcm-framer', PcmFramer);
