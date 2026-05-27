import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgendaEvent, EnhancedNotes, MeetingDetail, PersistedSegment, Template } from '../../shared/types';
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
import { ChatPanel } from '../features/chat/ChatPanel';
import { useChat } from '../features/chat/use-chat';
import { CrossChatView } from '../features/chat/CrossChatView';
import { useCrossChat } from '../features/chat/use-cross-chat';
import { useCalendar } from '../features/calendar/use-calendar';
import { useAutoStartScheduler } from '../features/calendar/use-auto-start-scheduler';
import { AgendaPanel } from '../features/calendar/AgendaPanel';
import { AutoStartPrompt } from '../features/calendar/AutoStartPrompt';
import { useDebouncedCallback } from '../lib/debounce';
import { CaptureProbe } from './CaptureProbe';
import { estimateCost, formatAudioDuration, formatCost } from '../../shared/pricing';
import { Download, Mic, Sparkles, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NO_TEMPLATE = 'none';

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
  const calendar = useCalendar();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const chat = useChat(selectedId);
  /** Right-column view: live transcript or per-meeting chat (ROADMAP_07 Phase 1). */
  const [rightTab, setRightTab] = useState<'transcript' | 'chat'>('transcript');

  // Cross-meeting querying (ROADMAP_07 Phase 2): a full-pane view, plus a deferred
  // highlight so a citation can open another meeting and flash the line once loaded.
  const crossChat = useCrossChat();
  const [showCrossChat, setShowCrossChat] = useState(false);
  const [pendingHighlight, setPendingHighlight] = useState<{
    meetingId: number;
    segmentId: number;
  } | null>(null);
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [highlight, setHighlight] = useState<TranscriptHighlight | null>(null);
  /** BCP-47 code detected by Deepgram during the current/last auto-detect session. */
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  /** Available templates (loaded once on mount). */
  const [templates, setTemplates] = useState<Template[]>([]);
  /** Whether the template picker modal is open before creating a new meeting. */
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  /** Speaker display names for the currently selected meeting (ROADMAP_02). */
  const [speakerNames, setSpeakerNames] = useState<Map<string, string>>(new Map());

  /** An armed calendar event that just reached its start time, awaiting confirm (ROADMAP_06). */
  const [duePrompt, setDuePrompt] = useState<AgendaEvent | null>(null);

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
  const error = transcription.error ?? capture.error ?? exportError;

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setLoadedSegments([]);
      setTitle('');
      setEnhanced(null);
      setSpeakerNames(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const [d, segs, names] = await Promise.all([
        window.api.meetings.get(selectedId),
        window.api.meetings.getTranscript(selectedId),
        window.api.speakers.get(selectedId),
      ]);
      if (cancelled) return;
      setDetail(d);
      setLoadedSegments(segs);
      setTitle(d?.title ?? '');
      setSpeakerNames(new Map(names.map((n) => [n.rawLabel, n.displayName])));
      const parsed = parseEnhanced(d?.enhancedJson ?? null);
      setEnhanced(parsed);
      setDegraded(false);
      setEnhanceError(null);
      setExportError(null);
      setView(parsed ? 'enhanced' : 'original');
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const saveTitle = useDebouncedCallback((id: number, value: string) => {
    void window.api.meetings.updateTitle(id, value).then(() => meetings.refresh());
  }, 500);

  const exportMeeting = async (id: number): Promise<void> => {
    setExporting(true);
    setExportError(null);
    try {
      await window.api.export.exportMeeting(id);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

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

  // Single start path: the button calls start() (defaults to the selected meeting);
  // calendar auto-start passes the target meeting explicitly (ROADMAP_06).
  const start = async (targetId: number | null = selectedId): Promise<void> => {
    if (targetId === null) return;
    setBusy(true);
    setDetectedLang(null); // reset for new session
    try {
      transcription.reset();
      await window.api.meetings.start(targetId);
      await transcription.start({ meetingId: targetId, sampleRate: 16000, channels: 2 });
      await capture.start();
      setActiveId(targetId);
      await meetings.refresh();
    } catch {
      await capture.stop();
      await transcription.stop();
      setActiveId(null);
    } finally {
      setBusy(false);
    }
  };

  // Auto-start for a calendar event: lazily create + link a meeting (so armed-but-
  // unattended events don't litter drafts), pre-fill its title, then run the normal
  // start flow. The recording indicator behaves exactly as a manual start.
  const startForCalendarEvent = async (event: AgendaEvent): Promise<void> => {
    if (running) return; // already recording something else
    let meetingId = event.meetingId;
    if (meetingId === null) {
      const meeting = await meetings.create();
      meetingId = meeting.id;
      await window.api.calendar.linkMeeting(event.providerId, event.externalId, meetingId);
    }
    if (event.title) await window.api.meetings.updateTitle(meetingId, event.title);
    await meetings.refresh();
    setSelectedId(meetingId);
    await start(meetingId);
  };

  // Surface the confirm prompt when an armed event is due (renderer-side scheduler).
  useAutoStartScheduler(calendar.agenda, (event) => {
    if (!running) setDuePrompt(event);
  });

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

  // ── Speaker naming (ROADMAP_02) ───────────────────────────────────────────

  /** Rename (or revert) a speaker label for the current meeting. */
  const onRenameSpeaker = useCallback(
    (rawLabel: string, displayName: string): void => {
      if (selectedId === null) return;
      if (displayName === rawLabel) {
        // User cleared the name — revert to the raw label.
        void window.api.speakers.clear(selectedId, rawLabel).then(() => {
          setSpeakerNames((prev) => {
            const next = new Map(prev);
            next.delete(rawLabel);
            return next;
          });
        });
      } else {
        void window.api.speakers.set(selectedId, rawLabel, displayName).then(() => {
          setSpeakerNames((prev) => {
            const next = new Map(prev);
            next.set(rawLabel, displayName);
            return next;
          });
        });
      }
    },
    [selectedId],
  );

  /** Reassign one segment to a different speaker label, then reload the transcript. */
  const onReassignSegment = useCallback(
    (segmentId: number, newRawLabel: string): void => {
      if (selectedId === null) return;
      void window.api.speakers.reassign(selectedId, segmentId, newRawLabel).then(() => {
        void window.api.meetings.getTranscript(selectedId).then(setLoadedSegments);
      });
    },
    [selectedId],
  );

  /** All distinct raw speaker labels across the loaded + live transcript. */
  const distinctRawLabels = useMemo(() => {
    const all = showingActive ? [...transcription.finals, ...loadedSegments] : loadedSegments;
    return [...new Set(all.map((s) => s.speakerLabel))];
  }, [showingActive, transcription.finals, loadedSegments]);

  // ─────────────────────────────────────────────────────────────────────────

  const list = meetings.results ?? meetings.meetings;
  const finals = showingActive ? transcription.finals : loadedSegments;
  const interims = showingActive ? transcription.interims : [];
  const hasEnhanced = enhanced !== null;
  // Chat is grounded in a finished transcript — available for an ended meeting, not
  // while recording (ROADMAP_07 Phase 1).
  const chatAvailable = !running && loadedSegments.length > 0;

  /** A chat citation jump: flash the cited transcript line and switch back to it. */
  const onCiteFromChat = useCallback((segmentId: number): void => {
    setHighlight({ ids: [segmentId], nonce: Date.now() });
    setRightTab('transcript');
  }, []);

  /** Cross-meeting citation jump: open the source meeting, then flash once it loads. */
  const onCiteFromCrossChat = useCallback((meetingId: number, segmentId: number): void => {
    setPendingHighlight({ meetingId, segmentId });
    setShowCrossChat(false);
    setSelectedId(meetingId);
  }, []);

  // Apply a pending cross-meeting highlight once the target meeting's transcript
  // has loaded (the segment must be present for TranscriptPanel to scroll to it).
  useEffect(() => {
    if (!pendingHighlight || pendingHighlight.meetingId !== selectedId) return;
    if (!loadedSegments.some((s) => s.id === pendingHighlight.segmentId)) return;
    setHighlight({ ids: [pendingHighlight.segmentId], nonce: Date.now() });
    setRightTab('transcript');
    setPendingHighlight(null);
  }, [pendingHighlight, selectedId, loadedSegments]);

  const wiped = async (): Promise<void> => {
    setShowSettings(false);
    setSelectedId(null);
    await meetings.refresh();
    await refreshSettings();
    setTemplates(await window.api.templates.list());
  };

  return (
    <div className="flex h-full bg-background text-foreground">
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
      {duePrompt && (
        <AutoStartPrompt
          event={duePrompt}
          onStart={() => {
            const event = duePrompt;
            setDuePrompt(null);
            void startForCalendarEvent(event);
          }}
          onDismiss={() => setDuePrompt(null)}
        />
      )}

      <MeetingSidebar
        meetings={list}
        templates={templates}
        selectedId={selectedId}
        searching={meetings.results !== null}
        disabled={running}
        onSelect={(id) => {
          setShowCrossChat(false);
          setSelectedId(id);
        }}
        onNew={() => void onNewNote()}
        onSearch={(q) => void meetings.search(q)}
        onDelete={(id) => void onDelete(id)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenCrossChat={() => setShowCrossChat(true)}
        agendaSlot={
          <AgendaPanel
            events={calendar.agenda}
            onArm={calendar.armEvent}
            onSelectMeeting={(id) => setSelectedId(id)}
          />
        }
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {showCrossChat ? (
          <CrossChatView
            controller={crossChat}
            meetings={meetings.meetings ?? []}
            onCiteClick={onCiteFromCrossChat}
            onClose={() => setShowCrossChat(false)}
          />
        ) : detail === null ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a meeting or create a new note.
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    saveTitle(detail.id, e.target.value);
                  }}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 bg-transparent text-base font-medium text-foreground focus:outline-none"
                  placeholder="Untitled meeting"
                />
                <Select
                  value={detail.templateId == null ? NO_TEMPLATE : String(detail.templateId)}
                  onValueChange={(v) => {
                    const newId = v === NO_TEMPLATE ? null : Number(v);
                    void window.api.meetings.setTemplate(detail.id, newId).then(() => {
                      void window.api.meetings.get(detail.id).then((d) => {
                        if (d) setDetail(d);
                      });
                    });
                  }}
                >
                  <SelectTrigger size="sm" className="shrink-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {running && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-destructive">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" />
                    Recording
                    {detectedLang && settings?.language.mode === 'auto' && (
                      <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        Detected: {detectedLang.toUpperCase()}
                      </span>
                    )}
                  </span>
                )}
                {running && transcription.reconnecting && (
                  <span className="flex shrink-0 items-center gap-1.5 rounded bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                    <span className="h-2 w-2 animate-spin rounded-full border border-warning border-t-transparent" />
                    Reconnecting…
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* Per-meeting cost chip — shown once transcription or enhancement has been used */}
                {!running && detail && (detail.usage.deepgramAudioMs > 0 || detail.usage.claudeInputTokens > 0) && (
                  <span
                    title={`Deepgram: ${formatAudioDuration(detail.usage.deepgramAudioMs)} · Claude: ${(detail.usage.claudeInputTokens + detail.usage.claudeOutputTokens).toLocaleString()} tokens`}
                    className="rounded bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                  >
                    ~{formatCost(estimateCost(detail.usage.deepgramAudioMs, detail.usage.claudeInputTokens, detail.usage.claudeOutputTokens))}
                    {detail.usage.deepgramAudioMs > 0 && (
                      <> · {formatAudioDuration(detail.usage.deepgramAudioMs)}</>
                    )}
                  </span>
                )}
                {hasEnhanced && (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={view}
                    onValueChange={(v) => { if (v) setView(v as 'original' | 'enhanced'); }}
                  >
                    <ToggleGroupItem value="original">Original</ToggleGroupItem>
                    <ToggleGroupItem value="enhanced">Enhanced</ToggleGroupItem>
                  </ToggleGroup>
                )}
                {!running && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void exportMeeting(detail.id)}
                      disabled={exporting}
                      title="Export meeting to Markdown file"
                    >
                      <Download />
                      {exporting ? 'Exporting…' : 'Export'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void enhanceMeeting(detail.id)}
                      disabled={enhancing}
                    >
                      <Sparkles />
                      {enhancing ? 'Enhancing…' : 'Enhance'}
                    </Button>
                  </>
                )}
                {running ? (
                  <Button variant="destructive" size="sm" onClick={() => void stop()}>
                    <Square />
                    Stop
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void start()} disabled={busy}>
                    <Mic />
                    {busy ? 'Starting…' : 'Start'}
                  </Button>
                )}
              </div>
            </header>

            {(error || enhanceError) && (
              <div className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-xs text-destructive">
                {error ?? enhanceError}
              </div>
            )}
            {view === 'enhanced' && degraded && (
              <div className="border-b border-warning/30 bg-warning/10 px-6 py-2 text-xs text-warning">
                Degraded result: structured enhancement failed, so this is a plain-text fallback.
              </div>
            )}

            <div className="flex flex-1 overflow-hidden">
              <section className="flex-1 overflow-y-auto border-r border-border p-6">
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
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={rightTab}
                  onValueChange={(v) => { if (v) setRightTab(v as 'transcript' | 'chat'); }}
                  className="mb-3"
                >
                  <ToggleGroupItem value="transcript">Transcript</ToggleGroupItem>
                  <ToggleGroupItem value="chat">Chat</ToggleGroupItem>
                </ToggleGroup>
                <div className="min-h-0 flex-1">
                  {rightTab === 'chat' ? (
                    <ChatPanel
                      controller={chat}
                      onCiteClick={onCiteFromChat}
                      available={chatAvailable}
                    />
                  ) : (
                    <TranscriptPanel
                      finals={finals}
                      interims={interims}
                      highlight={highlight}
                      speakerNames={speakerNames}
                      onRenameSpeaker={onRenameSpeaker}
                      onReassignSegment={onReassignSegment}
                      distinctRawLabels={distinctRawLabels}
                    />
                  )}
                </div>
                <details className="mt-4 text-xs text-muted-foreground">
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
