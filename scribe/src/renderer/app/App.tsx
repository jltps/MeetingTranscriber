import { useEffect, useRef, useState } from 'react';
import type { MeetingDetail, TranscriptSegment } from '../../shared/types';
import { useAudioCapture } from '../audio/use-audio-capture';
import { useTranscription } from '../features/transcript/use-transcription';
import { TranscriptPanel } from '../features/transcript/TranscriptPanel';
import { useMeetings } from '../features/meetings/use-meetings';
import { MeetingSidebar } from '../features/meetings/MeetingSidebar';
import { NotesEditor } from '../features/notes/NotesEditor';
import { useDebouncedCallback } from '../lib/debounce';
import { CaptureProbe } from './CaptureProbe';

// M3 ties it together: a meeting list with lifecycle, a TipTap notes editor that
// autosaves Markdown, a live/persisted transcript, and FTS search. One Start/Stop
// drives capture + transcription on the selected meeting and persists finals.
export function App() {
  const meetings = useMeetings();
  const transcription = useTranscription();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [loadedSegments, setLoadedSegments] = useState<TranscriptSegment[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const connectedRef = useRef(false);
  connectedRef.current = transcription.connected;
  const capture = useAudioCapture({
    onPcm: (pcm) => {
      if (connectedRef.current) window.api.pushAudioFrame(pcm);
    },
  });

  const running = capture.state === 'running' && activeId !== null;
  const showingActive = running && selectedId === activeId;
  const error = transcription.error ?? capture.error;

  // Load the selected meeting's notes + persisted transcript (not while it is the
  // live, actively-transcribing meeting — that view comes from the live stream).
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setLoadedSegments([]);
      setTitle('');
      return;
    }
    let cancelled = false;
    void (async () => {
      const [d, segs] = await Promise.all([
        window.api.meetings.get(selectedId),
        window.api.meetings.getTranscript(selectedId),
      ]);
      if (cancelled) return;
      setDetail(d);
      setLoadedSegments(segs);
      setTitle(d?.title ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const saveTitle = useDebouncedCallback((id: number, value: string) => {
    void window.api.meetings.updateTitle(id, value).then(() => meetings.refresh());
  }, 500);

  const onNewNote = async (): Promise<void> => {
    const meeting = await meetings.create();
    setSelectedId(meeting.id);
  };

  const onDelete = async (id: number): Promise<void> => {
    await meetings.remove(id);
    if (id === selectedId) setSelectedId(null);
  };

  const start = async (): Promise<void> => {
    if (selectedId === null) return;
    setBusy(true);
    try {
      transcription.reset();
      await window.api.meetings.start(selectedId);
      await transcription.start({ meetingId: selectedId, sampleRate: 16000, channels: 2 });
      await capture.start();
      setActiveId(selectedId);
      await meetings.refresh();
    } catch {
      await capture.stop();
      await transcription.stop();
      setActiveId(null);
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    try {
      await capture.stop();
      await transcription.stop();
      if (activeId !== null) {
        await window.api.meetings.end(activeId);
        const [d, segs] = await Promise.all([
          window.api.meetings.get(activeId),
          window.api.meetings.getTranscript(activeId),
        ]);
        setDetail(d);
        setLoadedSegments(segs);
        setTitle(d?.title ?? '');
      }
      setActiveId(null);
      await meetings.refresh();
    } finally {
      setBusy(false);
    }
  };

  const list = meetings.results ?? meetings.meetings;
  const finals = showingActive ? transcription.finals : loadedSegments;
  const interims = showingActive ? transcription.interims : [];

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-200">
      <MeetingSidebar
        meetings={list}
        selectedId={selectedId}
        searching={meetings.results !== null}
        disabled={running}
        onSelect={setSelectedId}
        onNew={() => void onNewNote()}
        onSearch={(q) => void meetings.search(q)}
        onDelete={(id) => void onDelete(id)}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {detail === null ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
            Select a meeting or create a new note.
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-4 border-b border-neutral-800 px-6 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    saveTitle(detail.id, e.target.value);
                  }}
                  className="min-w-0 flex-1 bg-transparent text-base font-medium text-neutral-200 focus:outline-none"
                  placeholder="Untitled meeting"
                />
                {running && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-red-400">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                    Recording
                  </span>
                )}
                {transcription.connected && (
                  <span className="shrink-0 text-[11px] text-emerald-400">transcribing</span>
                )}
              </div>
              {running ? (
                <button
                  type="button"
                  onClick={() => void stop()}
                  className="shrink-0 rounded-md bg-red-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-400"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={busy}
                  className="shrink-0 rounded-md bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-emerald-300 disabled:opacity-50"
                >
                  {busy ? 'Starting…' : 'Start'}
                </button>
              )}
            </header>

            {error && (
              <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <div className="flex flex-1 overflow-hidden">
              <section className="flex-1 overflow-y-auto border-r border-neutral-800 p-6">
                <NotesEditor
                  key={detail.id}
                  meetingId={detail.id}
                  initialMarkdown={detail.rawUserMd}
                  onSave={(id, markdown) => void window.api.meetings.saveNotes(id, markdown)}
                />
              </section>
              <section className="flex w-[42%] shrink-0 flex-col overflow-hidden p-6">
                <div className="min-h-0 flex-1">
                  <TranscriptPanel finals={finals} interims={interims} />
                </div>
                <details className="mt-4 text-xs text-neutral-500">
                  <summary className="cursor-pointer select-none">Capture diagnostics</summary>
                  <div className="mt-3">
                    <CaptureProbe controller={capture} />
                  </div>
                </details>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
