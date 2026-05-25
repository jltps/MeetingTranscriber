import { useEffect, useState } from 'react';
import type { AppStatus } from '../../shared/ipc-contract';
import { useAudioCapture } from '../audio/use-audio-capture';
import { CaptureProbe } from './CaptureProbe';

// M1: the main pane hosts the audio capture probe (mic + loopback → 2-ch 16 kHz
// PCM with per-channel VU meters). The sidebar and a real notes editor arrive in
// later milestones. The header shows an always-visible recording indicator while
// capture is active (PRODUCT_SPEC.md §7).
export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const capture = useAudioCapture();
  const recording = capture.state === 'running';

  useEffect(() => {
    window.api
      .getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-200">
      <aside className="flex w-72 flex-col border-r border-neutral-800 bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <span className="text-sm font-semibold tracking-wide">Scribe</span>
          <button
            type="button"
            className="rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
          >
            New Note
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-500">
          No meetings yet
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
          <div className="flex items-center gap-2.5">
            {recording && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                Recording
              </span>
            )}
            {!recording && <h1 className="text-base font-medium text-neutral-400">Untitled meeting</h1>}
          </div>
          <span className="text-[11px] text-neutral-600">
            {status
              ? `${status.platform} · v${status.appVersion} · db v${status.dbSchemaVersion}`
              : 'connecting…'}
          </span>
        </header>
        <div className="flex flex-1 items-center justify-center px-6 py-8">
          <CaptureProbe controller={capture} />
        </div>
      </main>
    </div>
  );
}
