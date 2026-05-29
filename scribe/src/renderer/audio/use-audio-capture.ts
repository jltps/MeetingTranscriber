import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioCapture,
  type CaptureFrame,
  type CaptureState,
  type MicFallbackStep,
  type SysTrackInfo,
} from './capture';

export type AudioCaptureController = {
  state: CaptureState;
  micLevel: number;
  sysLevel: number;
  frames: number;
  bytes: number;
  sampleRate: number | null;
  sysTrack: SysTrackInfo | null;
  /** Which mic-device fallback step succeeded (V073). null until capture starts. */
  micFallbackStep: MicFallbackStep | null;
  error: string | null;
  /** V075 ROADMAP_04 — when outputChannels=2, the worklet emits interleaved
   *  stereo (mic ch0, sys ch1) instead of a downmixed mono. */
  start: (opts?: { outputChannels?: 1 | 2 }) => Promise<void>;
  stop: () => Promise<void>;
};

export type UseAudioCaptureOptions = {
  // Called for each frame's mono PCM plus the per-frame mic/system RMS levels.
  // The PCM is forwarded to the main process for transcription; the levels let the
  // main process attribute "Me" (V05 ROADMAP_02). The buffer is never stored
  // locally (PRODUCT_SPEC.md §6.4).
  onPcm?: (pcm: ArrayBuffer, micLevel: number, sysLevel: number) => void;
  // The mic device chosen in Settings (§10); falls back to the OS default.
  micDeviceId?: string | null;
};

// React glue over AudioCapture. Owns the meter peak-hold/decay and the frame/byte
// counters. The PCM buffer in each frame is read for its size, optionally handed
// to onPcm, and then dropped — never stored. Unmount tears capture down.
export function useAudioCapture(options: UseAudioCaptureOptions = {}): AudioCaptureController {
  const captureRef = useRef<AudioCapture | null>(null);
  const micPeak = useRef(0);
  const sysPeak = useRef(0);
  const onPcmRef = useRef(options.onPcm);
  onPcmRef.current = options.onPcm;
  const micDeviceIdRef = useRef(options.micDeviceId);
  micDeviceIdRef.current = options.micDeviceId;

  const [state, setState] = useState<CaptureState>('idle');
  const [micLevel, setMicLevel] = useState(0);
  const [sysLevel, setSysLevel] = useState(0);
  const [frames, setFrames] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [sysTrack, setSysTrack] = useState<SysTrackInfo | null>(null);
  const [micFallbackStep, setMicFallbackStep] = useState<MicFallbackStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFrame = useCallback((frame: CaptureFrame) => {
    // Peak-hold with decay so the meter reads naturally instead of flickering.
    micPeak.current = Math.max(frame.micLevel, micPeak.current * 0.82);
    sysPeak.current = Math.max(frame.sysLevel, sysPeak.current * 0.82);
    setMicLevel(micPeak.current);
    setSysLevel(sysPeak.current);
    setFrames((n) => n + 1);
    setBytes((n) => n + frame.pcm.byteLength);
    // Forward to transcription if a consumer is listening, then drop the buffer.
    // It is never written to disk (PRODUCT_SPEC.md §6.4).
    onPcmRef.current?.(frame.pcm, frame.micLevel, frame.sysLevel);
  }, []);

  useEffect(() => {
    const capture = new AudioCapture({
      onFrame,
      onError: (e) => setError(e.message),
      onState: setState,
      onReady: ({ sampleRate: sr, micFallbackStep: step }) => {
        setSampleRate(sr);
        setMicFallbackStep(step);
      },
      onSysTrack: setSysTrack,
    });
    captureRef.current = capture;
    return () => {
      void capture.stop();
      captureRef.current = null;
    };
  }, [onFrame]);

  const start = useCallback(async (opts: { outputChannels?: 1 | 2 } = {}) => {
    setError(null);
    setFrames(0);
    setBytes(0);
    setSampleRate(null);
    setSysTrack(null);
    setMicFallbackStep(null);
    try {
      await captureRef.current?.start({
        micDeviceId: micDeviceIdRef.current ?? undefined,
        outputChannels: opts.outputChannels,
      });
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

  return {
    state,
    micLevel,
    sysLevel,
    frames,
    bytes,
    sampleRate,
    sysTrack,
    micFallbackStep,
    error,
    start,
    stop,
  };
}
