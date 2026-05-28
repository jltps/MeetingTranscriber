import { useEffect, useState } from 'react';
import type {
  AudioLoopbackDenied,
  TranscriptionWarning,
} from '../../../shared/ipc-contract';

// Non-blocking in-app banner for V073 audio issues: loopback grant failures
// (from the main `setDisplayMediaRequestHandler`) and the in-meeting silence
// watchdog. Visual language matches the existing inline notices in App.tsx —
// `border-b bg-warning/10 px-6 py-2 text-xs`. The user can always dismiss it;
// a `cleared` watchdog event auto-dismisses too.
export function AudioWarningBanner() {
  const [loopback, setLoopback] = useState<AudioLoopbackDenied | null>(null);
  const [watch, setWatch] = useState<TranscriptionWarning | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const offLoopback = window.api.onAudioLoopbackDenied((info) => {
      setLoopback(info);
      setDismissed(false);
    });
    const offWatch = window.api.onTranscriptionWarning((w) => {
      if (w.kind === 'cleared') {
        setWatch(null);
        return;
      }
      setWatch(w);
      setDismissed(false);
    });
    return () => {
      offLoopback();
      offWatch();
    };
  }, []);

  const active = !dismissed && (loopback || watch);
  if (!active) return null;
  const message = watch?.message ?? loopback?.reason ?? '';

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-6 py-2 text-xs text-warning"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        className="text-warning/80 hover:text-warning"
        onClick={() => setDismissed(true)}
      >
        Dismiss
      </button>
    </div>
  );
}
