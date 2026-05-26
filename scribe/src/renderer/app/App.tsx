import { useEffect, useRef, useState } from 'react';
import type { EnhancedNotes, MeetingDetail, PersistedSegment, Template } from '../../shared/types';
import { EnhancedNotesSchema } from '../../shared/ipc-contract';
import { useAudioCapture } from '../audio/use-audio-capture';
import { useTranscription } from '../features/transcript/use-transcription';
import { TranscriptPanel, type TranscriptHighlight } from '../features/transcript/TranscriptPanel';
import { useMeetings } from '../features/meetings/use-meetings';
import { MeetingSidebar } from '../features/meetings/MeetingSidebar';
import { NotesEditor } from '../features/notes/NotesEditor';
import { EnhancedNotesEditor } from '../features/notes/EnhancedNotesEditor';
import { useSettings } from '../features/settings/use-settings';
import { SettingsModal } from '../features/settings/SettingsModal';
import { PrivacyNotice } from '../features/settings/PrivacyNotice';
import { TemplatePickerModal } from '../features/templates/TemplatePickerModal';
import { useDebouncedCallback } from '../lib/debounce';
import { CaptureProbe } from './CaptureProbe';
import { estimateCost, formatAudioDuration, formatCost } from '../../shared/pricing';

function parseEnhanced(json: string | null): EnhancedNotes | null {
  if (!json) return null;
  try {
    const result = EnhancedNotesSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// M4 adds enhancement: on Stop (or via the Enhance button) the meeting's notes +
// transcript go to Claude, which returns structured notes. The enhanced view
// renders user vs AI text distinctly; editing AI text flips it to user-owned.
export function App() {
  const meetings = useMeetings();
  const transcription = useTranscription();
  const { settings, refresh: refreshSettings } = useSettings();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [loadedSegments, setLoadedSegments] = useState<PersistedSegment[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const [enhanced, setEnhanced] = useState<EnhancedNotes | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [view, setView] = useState<'original' | 'enhanced'>('original');
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [highlight, setHighlight] = useState<TranscriptHighlight | null>(null);
  /** BCP-47 code detected by Deepgram during the current/last auto-detect session. */
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  /** Available templates (loaded once on mount). */
  const [templates, setTemplates] = useState<Template[]>([]);
  /** Whether the template picker modal is open before creating a new meeting. */
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Subscribe to language detection events for the lifetime of the app.
  useEffect(() => {
    return window.api.onTranscriptionLanguage(({ bcp47 }) => setDetectedLang(bcp47));
  }, []);

  // Load templates once on mount (and after settings wipe, via wiped() callback).
  useEffect(() => {
    void window.api.templates.list().then(setTemplates);
  }, []);

  const connectedRef = useRef(false);
  connectedRef.current = transcription.connected;
  // Also push audio while reconnecting — the main-process session buffers frames
  // in RAM during the gap and flushes them on reconnect (ROADMAP_01 §A).
  const reconnectingRef = useRef(false);
  reconnectingRef.current = transcription.reconnecting;
  const capture = useAudioCapture({
    onPcm: (pcm) => {
      if (connectedRef.current || reconnectingRef.current) window.api.pushAudioFrame(pcm);
    },
    micDeviceId: settings?.micDeviceId ?? null,
  });

  const running = capture.state === 'running' && activeId !== null;
  const showingActive = running && selectedId === activeId;
  const error = transcription.error ?? capture.error;

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setLoadedSegments([]);
      setTitle('');
      setEnhanced(null);
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
      const parsed = parseEnhanced(d?.enhancedJson ?? null);
      setEnhanced(parsed);
      setDegraded(false);
      setEnhanceError(null);
      setView(parsed ? 'enhanced' : 'original');
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const saveTitle = useDebouncedCallback((id: number, value: string) => {
    void window.api.meetings.updateTitle(id, value).then(() => meetings.refresh());
  }, 500);

  const enhanceMeeting = async (id: number): Promise<void> => {
    setEnhancing(true);
    setEnhanceError(null);
    try {
      const result = await window.api.enhance(id);
      setEnhanced(result.notes);
      setDegraded(result.degraded);
      setView('enhanced');
    } catch (e) {
      setEnhanceError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnhancing(false);
    }
  };

  const onNewNote = (): void => {
    // Show template picker when more than just the default "General" template exists.
    // Otherwise create immediately for the one-click-default experience (FEATURES §C2).
    if (templates.length > 1) {
      setShowTemplatePicker(true);
    } else {
      void (async () => {
        const meeting = await meetings.create();
        setSelectedId(meeting.id);
      })();
    }
  };

  const createNoteWithTemplate = async (templateId: number | null): Promise<void> => {
    setShowTemplatePicker(false);
    const meeting = await meetings.create();
    if (templateId !== null) {
      await window.api.meetings.setTemplate(meeting.id, templateId);
    }
    setSelectedId(meeting.id);
  };

  const onDelete = async (id: number): Promise<void> => {
    const allMeetings = meetings.results ?? meetings.meetings;
    const target = allMeetings?.find((m) => m.id === id);
    const name = target?.title ?? 'this note';
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await meetings.remove(id);
    if (id === selectedId) setSelectedId(null);
  };

  const start = async (): Promise<void> => {
    if (selectedId === null) return;
    setBusy(true);
    setDetectedLang(null); // reset for new session
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
    const endedId = activeId;
    let endedSegments: PersistedSegment[] = [];
    try {
      await capture.stop();
      await transcription.stop();
      if (endedId !== null) {
        await window.api.meetings.end(endedId);
        const [d, segs] = await Promise.all([
          window.api.meetings.get(endedId),
          window.api.meetings.getTranscript(endedId),
        ]);
        endedSegments = segs;
        setDetail(d);
        setLoadedSegments(segs);
        setTitle(d?.title ?? '');
      }
      setActiveId(null);
      await meetings.refresh();
    } finally {
      setBusy(false);
    }
    // Auto-title if still untitled and transcript exists — before enhancement so the
    // title is already set when enhancement stores it. Runs fire-and-forget style
    // but we await it so the sidebar title updates before the enhance banner appears.
    if (endedId !== null && endedSegments.length > 0) {
      const currentDetail = await window.api.meetings.get(endedId);
      if (currentDetail?.title === 'Untitled meeting') {
        const suggested = await window.api.meetings.suggestTitle(endedId);
        if (suggested) {
          await window.api.meetings.updateTitle(endedId, suggested);
          setTitle(suggested);
          await meetings.refresh();
        }
      }
    }
    // Auto-enhance once the meeting has ended and a transcript exists (§4).
    if (endedId !== null && endedSegments.length > 0) {
      await enhanceMeeting(endedId);
    }
  };

  const list = meetings.results ?? meetings.meetings;
  const finals = showingActive ? transcription.finals : loadedSegments;
  const interims = showingActive ? transcription.interims : [];
  const hasEnhanced = enhanced !== null;

  const wiped = async (): Promise<void> => {
    setShowSettings(false);
    setSelectedId(null);
    await meetings.refresh();
    await refreshSettings();
    setTemplates(await window.api.templates.list());
  };

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-200">
      {settings && !settings.privacyAccepted && (
        <PrivacyNotice
          onAccept={() => {
            void window.api.settings.acceptPrivacy().then(refreshSettings);
          }}
        />
      )}
      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          templates={templates}
          onClose={() => setShowSettings(false)}
          onChanged={() => {
            void refreshSettings();
            void window.api.templates.list().then(setTemplates);
          }}
          onWiped={() => void wiped()}
        />
      )}
      {showTemplatePicker && (
        <TemplatePickerModal
          templates={templates}
          onSelect={(templateId) => void createNoteWithTemplate(templateId)}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}

      <MeetingSidebar
        meetings={list}
        templates={templates}
        selectedId={selectedId}
        searching={meetings.results !== null}
        disabled={running}
        onSelect={setSelectedId}
        onNew={() => void onNewNote()}
        onSearch={(q) => void meetings.search(q)}
        onDelete={(id) => void onDelete(id)}
        onOpenSettings={() => setShowSettings(true)}
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
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 bg-transparent text-base font-medium text-neutral-200 focus:outline-none"
                  placeholder="Untitled meeting"
                />
                <select
                  value={detail.templateId ?? ''}
                  onChange={(e) => {
                    const newId = e.target.value ? Number(e.target.value) : null;
                    void window.api.meetings.setTemplate(detail.id, newId).then(() => {
                      void window.api.meetings.get(detail.id).then((d) => {
                        if (d) setDetail(d);
                      });
                    });
                  }}
                  className="rounded border border-neutral-700 bg-transparent px-2 py-1 text-xs text-neutral-400 focus:outline-none"
                >
                  <option value="">No template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {running && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-red-400">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                    Recording
                    {detectedLang && settings?.language.mode === 'auto' && (
                      <span className="ml-1.5 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-normal text-neutral-400">
                        Detected: {detectedLang.toUpperCase()}
                      </span>
                    )}
                  </span>
                )}
                {running && transcription.reconnecting && (
                  <span className="flex shrink-0 items-center gap-1.5 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
                    <span className="h-2 w-2 animate-spin rounded-full border border-amber-400 border-t-transparent" />
                    Reconnecting…
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* Per-meeting cost chip — shown once transcription or enhancement has been used */}
                {!running && detail && (detail.usage.deepgramAudioMs > 0 || detail.usage.claudeInputTokens > 0) && (
                  <span
                    title={`Deepgram: ${formatAudioDuration(detail.usage.deepgramAudioMs)} · Claude: ${(detail.usage.claudeInputTokens + detail.usage.claudeOutputTokens).toLocaleString()} tokens`}
                    className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] tabular-nums text-neutral-500"
                  >
                    ~{formatCost(estimateCost(detail.usage.deepgramAudioMs, detail.usage.claudeInputTokens, detail.usage.claudeOutputTokens))}
                    {detail.usage.deepgramAudioMs > 0 && (
                      <> · {formatAudioDuration(detail.usage.deepgramAudioMs)}</>
                    )}
                  </span>
                )}
                {hasEnhanced && (
                  <div className="flex overflow-hidden rounded-md border border-neutral-700 text-xs">
                    <button
                      type="button"
                      onClick={() => setView('original')}
                      className={`px-2.5 py-1 ${view === 'original' ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400'}`}
                    >
                      Original
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('enhanced')}
                      className={`px-2.5 py-1 ${view === 'enhanced' ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400'}`}
                    >
                      Enhanced
                    </button>
                  </div>
                )}
                {!running && (
                  <button
                    type="button"
                    onClick={() => void enhanceMeeting(detail.id)}
                    disabled={enhancing}
                    className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {enhancing ? 'Enhancing…' : 'Enhance'}
                  </button>
                )}
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

            {(error || enhanceError) && (
              <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-xs text-red-300">
                {error ?? enhanceError}
              </div>
            )}
            {view === 'enhanced' && degraded && (
              <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-300">
                Degraded result: structured enhancement failed, so this is a plain-text fallback.
              </div>
            )}

            <div className="flex flex-1 overflow-hidden">
              <section className="flex-1 overflow-y-auto border-r border-neutral-800 p-6">
                {view === 'enhanced' && enhanced ? (
                  <EnhancedNotesEditor
                    key={`enhanced-${detail.id}`}
                    meetingId={detail.id}
                    notes={enhanced}
                    onSave={(id, notes) => void window.api.meetings.saveEnhanced(id, notes)}
                    onJump={(ids) => setHighlight({ ids, nonce: Date.now() })}
                  />
                ) : (
                  <NotesEditor
                    key={detail.id}
                    meetingId={detail.id}
                    initialMarkdown={detail.rawUserMd}
                    onSave={(id, markdown) => void window.api.meetings.saveNotes(id, markdown)}
                  />
                )}
              </section>
              <section className="flex w-[42%] shrink-0 flex-col overflow-hidden p-6">
                <div className="min-h-0 flex-1">
                  <TranscriptPanel finals={finals} interims={interims} highlight={highlight} />
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
