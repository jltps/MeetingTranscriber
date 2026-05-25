import { useEffect, useRef, useState } from 'react';
import type { AppStatus } from '../../shared/ipc-contract';
import { useAudioCapture } from '../audio/use-audio-capture';
import { useTranscription } from '../features/transcript/use-transcription';
import { TranscriptPanel } from '../features/transcript/TranscriptPanel';
import { CaptureProbe } from './CaptureProbe';

// M2: one Start/Stop drives capture + transcription together. Captured PCM frames
// are forwarded to the main process (which owns the Deepgram socket) only while
// the connection is open. The transcript panel is the main view; capture meters
// move to a diagnostics aside. Notes editor arrives in M3.
export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const transcription = useTranscription();
  const connectedRef = useRef(false);
  connectedRef.current = transcription.connected;

  const capture = useAudioCapture({
    onPcm: (pcm) => {
      if (connectedRef.current) window.api.pushAudioFrame(pcm);
    },
  });

  const running = capture.state === 'running';
  const error = transcription.error ?? capture.error;

  useEffect(() => {
    window.api
      .getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      transcription.reset();
      await transcription.start({ sampleRate: 16000, channels: 2 });
      await capture.start();
    } catch {
      await capture.stop();
      await transcription.stop();
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    try {
      await capture.stop();
      await transcription.stop();
    } finally {
      setBusy(false);
    }
  };

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

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
          <div className="flex items-center gap-3">
            {running ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                Recording
              </span>
            ) : (
              <h1 className="text-base font-medium text-neutral-400">Untitled meeting</h1>
            )}
            {transcription.connected && (
              <span className="text-[11px] text-emerald-400">transcribing</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-neutral-600">
              {status
                ? `${status.platform} · v${status.appVersion} · db v${status.dbSchemaVersion}`
                : 'connecting…'}
            </span>
            {running ? (
              <button
                type="button"
                onClick={() => void stop()}
                className="rounded-md bg-red-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-400"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy}
                className="rounded-md bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-emerald-300 disabled:opacity-50"
              >
                {busy ? 'Starting…' : 'Start'}
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          <section className="flex flex-1 flex-col overflow-hidden p-6">
            <TranscriptPanel finals={transcription.finals} interims={transcription.interims} />
          </section>
          <aside className="w-96 shrink-0 overflow-y-auto border-l border-neutral-800 p-4">
            <CaptureProbe controller={capture} />
          </aside>
        </div>
      </main>
    </div>
  );
}
