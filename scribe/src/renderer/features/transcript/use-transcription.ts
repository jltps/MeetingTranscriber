import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../../../shared/types';
import type { TranscriptionStart } from '../../../shared/ipc-contract';

export type TranscriptionController = {
  finals: TranscriptSegment[];
  interims: TranscriptSegment[]; // current in-progress lines, at most one per channel
  connected: boolean;
  /** True while the session is attempting to reconnect after an unexpected drop. */
  reconnecting: boolean;
  error: string | null;
  start: (opts: TranscriptionStart) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
};

// Holds the live transcript model and the transcription connection state. Interim
// results are keyed by channel (each new interim replaces the previous one for
// that channel); a final clears its channel's interim and appends (PRODUCT_SPEC.md
// §8.2). Segments arrive from the main process over the typed bridge.
export function useTranscription(): TranscriptionController {
  const [finals, setFinals] = useState<TranscriptSegment[]>([]);
  const [interims, setInterims] = useState<TranscriptSegment[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const interimByChannel = useRef<Map<0 | 1, TranscriptSegment>>(new Map());

  useEffect(() => {
    const offSegment = window.api.onTranscriptSegment((seg) => {
      if (seg.isFinal) {
        interimByChannel.current.delete(seg.channel);
        setInterims([...interimByChannel.current.values()]);
        setFinals((prev) => [...prev, seg]);
      } else {
        interimByChannel.current.set(seg.channel, seg);
        setInterims([...interimByChannel.current.values()]);
      }
    });
    const offStatus = window.api.onTranscriptionStatus((status) => {
      if (status.state === 'open') {
        setConnected(true);
        setReconnecting(false);
        setError(null);
      } else if (status.state === 'reconnecting') {
        setConnected(false);
        setReconnecting(true);
        setError(null);
      } else if (status.state === 'closed') {
        setConnected(false);
        setReconnecting(false);
      } else {
        // 'error' — unrecoverable
        setConnected(false);
        setReconnecting(false);
        setError(status.message ?? 'Transcription error');
      }
    });
    return () => {
      offSegment();
      offStatus();
    };
  }, []);

  const start = useCallback(async (opts: TranscriptionStart) => {
    setError(null);
    try {
      await window.api.startTranscription(opts);
      setConnected(true);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, []);

  const stop = useCallback(async () => {
    await window.api.stopTranscription();
    setConnected(false);
  }, []);

  const reset = useCallback(() => {
    interimByChannel.current.clear();
    setInterims([]);
    setFinals([]);
    setError(null);
    setReconnecting(false);
  }, []);

  return { finals, interims, connected, reconnecting, error, start, stop, reset };
}
