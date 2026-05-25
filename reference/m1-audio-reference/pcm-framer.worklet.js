// Runs in AudioWorkletGlobalScope (plain JS, served from /public so no bundler
// gymnastics). The AudioContext is created at 16 kHz upstream, so there is NO
// resampling to do here — the browser already resampled both inputs. This
// processor only:
//   - reads input 0 (microphone  -> channel 0 "Me")
//   - reads input 1 (system audio -> channel 1 "Others")
//   - interleaves them into 16-bit PCM   [mic0, sys0, mic1, sys1, ...]
//     (exactly the layout Deepgram multichannel linear16 expects in M2)
//   - frames to ~100 ms and posts each frame + per-channel RMS to the renderer
//
// Nothing is buffered beyond one in-flight frame. No audio is stored.

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
    const out = new Int16Array(FRAME_SAMPLES * 2); // interleaved stereo
    let micSum = 0;
    let sysSum = 0;
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      const m = Math.max(-1, Math.min(1, this._mic[i]));
      const s = Math.max(-1, Math.min(1, this._sys[i]));
      out[i * 2] = m < 0 ? m * 0x8000 : m * 0x7fff;
      out[i * 2 + 1] = s < 0 ? s * 0x8000 : s * 0x7fff;
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
