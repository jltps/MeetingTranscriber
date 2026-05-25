import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioCapture, type CaptureFrame, type CaptureState, type SysTrackInfo } from './capture';

export type AudioCaptureController = {
  state: CaptureState;
  micLevel: number;
  sysLevel: number;
  frames: number;
  bytes: number;
  sampleRate: number | null;
  sysTrack: SysTrackInfo | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

// React glue over AudioCapture. Owns the meter peak-hold/decay and the frame/byte
// counters. The PCM buffer in each frame is read for its size and then dropped —
// it is never stored anywhere (PRODUCT_SPEC.md §6.4). Unmount tears capture down.
export function useAudioCapture(): AudioCaptureController {
  const captureRef = useRef<AudioCapture | null>(null);
  const micPeak = useRef(0);
  const sysPeak = useRef(0);

  const [state, setState] = useState<CaptureState>('idle');
  const [micLevel, setMicLevel] = useState(0);
  const [sysLevel, setSysLevel] = useState(0);
  const [frames, setFrames] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [sysTrack, setSysTrack] = useState<SysTrackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFrame = useCallback((frame: CaptureFrame) => {
    // Peak-hold with decay so the meter reads naturally instead of flickering.
    micPeak.current = Math.max(frame.micLevel, micPeak.current * 0.82);
    sysPeak.current = Math.max(frame.sysLevel, sysPeak.current * 0.82);
    setMicLevel(micPeak.current);
    setSysLevel(sysPeak.current);
    setFrames((n) => n + 1);
    setBytes((n) => n + frame.pcm.byteLength);
    // frame.pcm is intentionally dropped here — no audio is ever persisted.
  }, []);

  useEffect(() => {
    const capture = new AudioCapture({
      onFrame,
      onError: (e) => setError(e.message),
      onState: setState,
      onReady: ({ sampleRate: sr }) => setSampleRate(sr),
      onSysTrack: setSysTrack,
    });
    captureRef.current = capture;
    return () => {
      void capture.stop();
      captureRef.current = null;
    };
  }, [onFrame]);

  const start = useCallback(async () => {
    setError(null);
    setFrames(0);
    setBytes(0);
    setSampleRate(null);
    setSysTrack(null);
    try {
      await captureRef.current?.start();
    } catch {
      /* surfaced via onError */
    }
  }, []);

  const stop = useCallback(async () => {
    await captureRef.current?.stop();
    micPeak.current = 0;
    sysPeak.current = 0;
    setMicLevel(0);
    setSysLevel(0);
  }, []);

  return { state, micLevel, sysLevel, frames, bytes, sampleRate, sysTrack, error, start, stop };
}
