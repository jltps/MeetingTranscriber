import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgendaEvent, EnhancedNotes, MeetingDetail, PersistedSegment, Template } from '../../shared/types';
import { EnhancedNotesSchema } from '../../shared/ipc-contract';
import { useAudioCapture } from '../audio/use-audio-capture';
import { useTranscription } from '../features/transcript/use-transcription';
import { TranscriptPanel, type TranscriptHighlight } from '../features/transcript/TranscriptPanel';
import { useMeetings } from '../features/meetings/use-meetings';
import { MeetingSidebar } from '../features/meetings/MeetingSidebar';
import { NotesEditor } from '../features/notes/NotesEditor';
import { EnhancedPane } from '../features/notes/EnhancedPane';
import { NoteWindowHeader } from '../features/notes/NoteWindowHeader';
import { useSettings } from '../features/settings/use-settings';
import { SettingsModal } from '../features/settings/SettingsModal';
import { AudioWarningBanner } from '../features/settings/AudioWarningBanner';
import { OnboardingFlow } from '../features/onboarding/OnboardingFlow';
import { TemplatePickerModal } from '../features/templates/TemplatePickerModal';
import { TemplatesPage } from '../features/templates/TemplatesPage';
import { ChatPanel } from '../features/chat/ChatPanel';
import { useChat } from '../features/chat/use-chat';
import { CrossChatView } from '../features/chat/CrossChatView';
import { useCrossChat } from '../features/chat/use-cross-chat';
import { useCalendar } from '../features/calendar/use-calendar';
import { useAutoStartScheduler } from '../features/calendar/use-auto-start-scheduler';
import { AgendaPanel } from '../features/calendar/AgendaPanel';
import { AutoStartPrompt } from '../features/calendar/AutoStartPrompt';
import { useDebouncedCallback } from '../lib/debounce';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { useOrganization } from '../features/organization/use-organization';
import { useTheme } from '../features/theme/use-theme';
import { useLayoutMode } from '../features/layout/use-responsive';
import { LayoutShell } from '../features/layout/LayoutShell';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { CommandPalette } from '../features/commands/CommandPalette';
import { buildActions } from '../features/commands/actions';
import { useShortcuts } from '../features/commands/use-shortcuts';
import { CaptureProbe } from './CaptureProbe';
import { TitleBar } from './TitleBar';
import { UpdateBanner } from '../features/updates/UpdateBanner';
import { AboutDialog } from '../features/updates/AboutDialog';
import { Mic, NotebookPen, PanelRightClose, PanelRightOpen, Sparkles, Square } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
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
  const org = useOrganization();
  const { theme, setMode } = useTheme();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const chat = useChat(selectedId);

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
  // V072 block 02: the note window's primary surface — notes (Original/Enhanced)
  // or per-meeting chat. Chat used to live as a tab in the right column; it now
  // takes over the notes pane when active.
  const [noteSurface, setNoteSurface] = useState<'notes' | 'chat'>('notes');
  // Whether the transcript/chat side panel is shown (wide layout). Hiding it gives the
  // notes the full width. Local + default visible.
  const [transcriptVisible, setTranscriptVisible] = useState(true);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  // V074 block 04 — top-level routing between the meetings workspace and the
  // standalone Templates page. Templates is full-screen so it replaces the
  // LayoutShell entirely; the TitleBar stays mounted for window controls.
  const [appView, setAppView] = useState<'meetings' | 'templates'>('meetings');
  const [paletteOpen, setPaletteOpen] = useState(false);
  // First-run onboarding (ROADMAP_V04_07). Local-state controlled so the flow doesn't
  // vanish mid-way when its privacy step persists; shown once when settings load unonboarded.
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Layout (ROADMAP_V04_06): responsive mode, narrow-mode meeting tab, sidebar drawer.
  const layoutMode = useLayoutMode();
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mainTab, setMainTab] = useState<'notes' | 'transcript' | 'chat'>('notes');
  const toggleSidebar = useCallback(() => {
    if (layoutMode === 'wide') {
      const p = sidebarPanelRef.current;
      if (p) {
        if (p.isCollapsed()) p.expand();
        else p.collapse();
      }
    } else {
      setDrawerOpen((o) => !o);
    }
  }, [layoutMode]);
  const [highlight, setHighlight] = useState<TranscriptHighlight | null>(null);
  /** BCP-47 code detected by Deepgram during the current/last auto-detect session. */
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  /** Available templates (loaded once on mount). */
  const [templates, setTemplates] = useState<Template[]>([]);
  /** Whether the template picker modal is open before creating a new meeting. */
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  /** Folder a pending new note should land in (set when the picker is opened). */
  const [pendingFolderId, setPendingFolderId] = useState<number | null>(null);

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

  // Show first-run onboarding once settings load unonboarded (ROADMAP_V04_07).
  useEffect(() => {
    if (settings && !settings.onboardingDone) setShowOnboarding(true);
  }, [settings]);

  const connectedRef = useRef(false);
  connectedRef.current = transcription.connected;
  // Also push audio while reconnecting — the main-process session buffers frames
  // in RAM during the gap and flushes them on reconnect (ROADMAP_01 §A).
  const reconnectingRef = useRef(false);
  reconnectingRef.current = transcription.reconnecting;
  const capture = useAudioCapture({
    onPcm: (pcm, micLevel, sysLevel) => {
      if (connectedRef.current || reconnectingRef.current)
        window.api.pushAudioFrame(pcm, micLevel, sysLevel);
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
      // Switching meetings always lands on notes, never chat (V072 block 02).
      setNoteSurface('notes');
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

  // The notes pane (enhanced or raw), reused by the wide split, the wide full-width
  // (transcript hidden), and the narrow layout so the three never diverge.
  const renderNotes = () => {
    if (!detail) return null;
    return view === 'enhanced' && enhanced ? (
      <EnhancedPane
        key={`enhanced-${detail.id}`}
        meetingId={detail.id}
        notes={enhanced}
        onSaveEnhanced={(id, notes) => void window.api.meetings.saveEnhanced(id, notes)}
        onJump={(ids) => setHighlight({ ids, nonce: Date.now() })}
      />
    ) : (
      <NotesEditor
        key={detail.id}
        meetingId={detail.id}
        initialMarkdown={detail.rawUserMd}
        onSave={(id, markdown) => void window.api.meetings.saveNotes(id, markdown)}
      />
    );
  };

  // The note window's primary surface — NoteWindowHeader above either the notes
  // pane (renderNotes) or the per-meeting ChatPanel, swapped by noteSurface
  // (V072 block 02). Used in both wide and narrow layouts so the header and
  // chat-takeover behave identically across responsive modes.
  const renderNoteSurface = () => {
    if (!detail) return null;
    const hasEnhanced = enhanced !== null;
    return (
      <div className="flex h-full flex-col">
        <NoteWindowHeader
          meetingId={detail.id}
          folderId={detail.folderId}
          tagNames={detail.tags}
          folders={org.folders}
          tags={org.tags}
          hasEnhanced={hasEnhanced}
          view={view}
          surface={noteSurface}
          exporting={exporting}
          recording={running}
          onViewChange={setView}
          onSurfaceChange={setNoteSurface}
          onSetFolder={setMeetingFolder}
          onAddTag={addMeetingTag}
          onRemoveTag={removeMeetingTag}
          onCreateTag={org.createTag}
          onExport={() => void exportMeeting(detail.id)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {noteSurface === 'chat' ? (
            <ChatPanel
              controller={chat}
              onCiteClick={onCiteFromChat}
              available={chatAvailable}
              keyMissing={!settings?.anthropicKeySet}
              onConnectKeys={() => setShowSettings(true)}
            />
          ) : (
            renderNotes()
          )}
        </div>
      </div>
    );
  };

  // Create a note, optionally with a template and filed into a folder (ROADMAP_V04_04).
  const createNote = async (templateId: number | null, folderId: number | null): Promise<void> => {
    const meeting = await meetings.create();
    if (templateId !== null) await window.api.meetings.setTemplate(meeting.id, templateId);
    if (folderId !== null) await window.api.organization.setMeetingFolder(meeting.id, folderId);
    if (templateId !== null || folderId !== null) await meetings.refresh();
    setSelectedId(meeting.id);
  };

  const onNewNote = (folderId: number | null = null): void => {
    // Show template picker when more than just the default "General" template exists.
    // Otherwise create immediately for the one-click-default experience (FEATURES §C2).
    if (templates.length > 1) {
      setPendingFolderId(folderId);
      setShowTemplatePicker(true);
    } else {
      void createNote(null, folderId);
    }
  };

  const createNoteWithTemplate = async (templateId: number | null): Promise<void> => {
    setShowTemplatePicker(false);
    await createNote(templateId, pendingFolderId);
    setPendingFolderId(null);
  };

  // Per-meeting folder/tag assignment (ROADMAP_V04_04): mutate, then refresh the
  // list (summaries carry folder/tags) and the open detail (header controls).
  const refreshAfterOrg = async (meetingId: number): Promise<void> => {
    await meetings.refresh();
    if (detail?.id === meetingId) {
      const d = await window.api.meetings.get(meetingId);
      if (d) setDetail(d);
    }
  };
  const setMeetingFolder = (meetingId: number, folderId: number | null): void => {
    void window.api.organization.setMeetingFolder(meetingId, folderId).then(() => refreshAfterOrg(meetingId));
  };
  const addMeetingTag = (meetingId: number, tagId: number): void => {
    void window.api.organization.addMeetingTag(meetingId, tagId).then(() => refreshAfterOrg(meetingId));
  };
  const removeMeetingTag = (meetingId: number, tagId: number): void => {
    void window.api.organization.removeMeetingTag(meetingId, tagId).then(() => refreshAfterOrg(meetingId));
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
      // V075 ROADMAP_04 — capture quality tier.
      //  - 'cost-saver' (default): one downmixed mono channel; "Me" recovered
      //    via the V073 bleed-aware heuristic. ~1× Deepgram cost.
      //  - 'best-quality': 2-channel interleaved (mic = ch0 always "Me",
      //    sys = ch1 diarized for remotes via multichannel=true + diarize=true).
      //    ~2× Deepgram cost; eliminates own-voice bleed at the source.
      const channels: 1 | 2 = settings?.captureQuality === 'best-quality' ? 2 : 1;
      await transcription.start({ meetingId: targetId, sampleRate: 16000, channels });
      await capture.start({ outputChannels: channels });
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

  // Command palette + keyboard shortcuts (ROADMAP_V04_05). The action registry is
  // rebuilt from live state each render so closures + `enabled` flags stay fresh.
  const cycleTheme = (): void => {
    const order = ['system', 'light', 'dark'] as const;
    const cur = theme?.mode ?? 'system';
    void setMode(order[(order.indexOf(cur) + 1) % order.length]);
  };
  const actions = buildActions({
    onNewNote: () => onNewNote(),
    openSettings: () => setShowSettings(true),
    openCrossChat: () => setShowCrossChat(true),
    toggleTheme: cycleTheme,
    toggleSidebar,
    focusSearch: () =>
      document.querySelector<HTMLInputElement>('[data-search-input]')?.focus(),
    exportMeeting: () => {
      if (detail) void exportMeeting(detail.id);
    },
    enhanceMeeting: () => {
      if (detail) void enhanceMeeting(detail.id);
    },
    startRecording: () => void start(),
    stopRecording: () => void stop(),
    setView,
    setNoteSurface,
    hasMeeting: detail !== null,
    running,
    hasEnhanced,
    view,
    noteSurface,
  });
  useShortcuts(actions, () => setPaletteOpen((o) => !o));

  /** A chat citation jump: flash the cited transcript line + return to the notes
      surface so the cite is visible against the notes pane and the right-column
      transcript. */
  const onCiteFromChat = useCallback((segmentId: number): void => {
    setHighlight({ ids: [segmentId], nonce: Date.now() });
    setNoteSurface('notes');
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
    setPendingHighlight(null);
  }, [pendingHighlight, selectedId, loadedSegments]);

  const wiped = async (): Promise<void> => {
    setShowSettings(false);
    setSelectedId(null);
    await meetings.refresh();
    await refreshSettings();
    await org.reload();
    setTemplates(await window.api.templates.list());
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {showOnboarding && settings && (
        <OnboardingFlow
          settings={settings}
          onChanged={refreshSettings}
          onComplete={() => {
            setShowOnboarding(false);
            void refreshSettings();
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
          onManageTemplates={() => {
            setShowSettings(false);
            setAppView('templates');
          }}
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

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={actions}
        meetings={meetings.results ?? meetings.meetings}
        onOpenMeeting={(id) => {
          setShowCrossChat(false);
          setSelectedId(id);
        }}
      />

      <TitleBar
        onOpenSettings={() => setShowSettings(true)}
        onToggleSidebar={toggleSidebar}
        onOpenAbout={() => setShowAbout(true)}
      />

      <UpdateBanner />
      <AudioWarningBanner />

      <AboutDialog open={showAbout} onClose={() => setShowAbout(false)} />

      {appView === 'templates' ? (
        <TemplatesPage
          templates={templates}
          onChanged={() => {
            void window.api.templates.list().then(setTemplates);
          }}
          onBack={() => setAppView('meetings')}
        />
      ) : (
      <LayoutShell
        mode={layoutMode}
        sidebarRef={sidebarPanelRef}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
        sidebar={
          <MeetingSidebar
            meetings={list}
            templates={templates}
            folders={org.folders}
            tags={org.tags}
            org={org}
            selectedId={selectedId}
            searching={meetings.results !== null}
            disabled={running}
            onSelect={(id) => {
              setShowCrossChat(false);
              setSelectedId(id);
              setDrawerOpen(false);
            }}
            onNew={(folderId) => {
              onNewNote(folderId);
              setDrawerOpen(false);
            }}
            onSearch={(q) => void meetings.search(q)}
            onDelete={(id) => void onDelete(id)}
            onSetMeetingFolder={setMeetingFolder}
            onAddMeetingTag={addMeetingTag}
            onRemoveMeetingTag={removeMeetingTag}
            onOpenCrossChat={() => {
              setShowCrossChat(true);
              setDrawerOpen(false);
            }}
            cardView={settings?.notesCardView ?? 'extended'}
            onCardViewChange={(v) => {
              void window.api.settings.setNotesCardView(v).then(() => refreshSettings());
            }}
            agendaSlot={
              <AgendaPanel
                events={calendar.agenda}
                onArm={calendar.armEvent}
                onSelectMeeting={(id) => {
                  setSelectedId(id);
                  setDrawerOpen(false);
                }}
              />
            }
          />
        }
      >
        <main className="flex h-full flex-col overflow-hidden">
        {showCrossChat ? (
          <CrossChatView
            controller={crossChat}
            meetings={meetings.meetings ?? []}
            folders={org.folders}
            tags={org.tags}
            onCiteClick={onCiteFromCrossChat}
            onClose={() => setShowCrossChat(false)}
            keyMissing={!settings?.anthropicKeySet}
            onConnectKeys={() => setShowSettings(true)}
          />
        ) : detail === null ? (
          <EmptyState
            icon={NotebookPen}
            title="No note open"
            description="Pick a note from the sidebar, or start a new one to capture a meeting."
            action={{ label: 'New note', onClick: () => onNewNote() }}
            secondaryAction={
              settings && (!settings.anthropicKeySet || !settings.deepgramKeySet)
                ? { label: 'Connect API keys', onClick: () => setShowSettings(true) }
                : undefined
            }
          />
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-6 py-3">
              <div className="flex min-w-[12rem] flex-1 items-center gap-3">
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    saveTitle(detail.id, e.target.value);
                  }}
                  onFocus={(e) => e.target.select()}
                  aria-label="Meeting title"
                  className="min-w-0 flex-1 rounded bg-transparent text-base font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                {/* Folder picker + Tags dropdown moved into the note window's
                    unified header (V072 block 02 — NoteWindowHeader). */}
                {running && (
                  <span role="status" className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-destructive">
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
                  <span role="status" className="flex shrink-0 items-center gap-1.5 rounded bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                    <span className="h-2 w-2 animate-spin rounded-full border border-warning border-t-transparent" />
                    Reconnecting…
                  </span>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 ml-auto">
                {/* Cost moved out of the header (V06 block 06) — it lives in Settings → Usage & Cost.
                    The Extended / Key points depth toggle moved into the notes pane (EnhancedPane).
                    The Original/Enhanced toggle and Export button moved into the note window's
                    unified header (V072 block 02 — NoteWindowHeader). */}
                {layoutMode === 'wide' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTranscriptVisible((v) => !v)}
                    title={transcriptVisible ? 'Hide transcript panel' : 'Show transcript panel'}
                  >
                    {transcriptVisible ? <PanelRightClose /> : <PanelRightOpen />}
                    {transcriptVisible ? 'Hide transcript' : 'Show transcript'}
                  </Button>
                )}
                {!running && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void enhanceMeeting(detail.id)}
                    disabled={enhancing}
                  >
                    <Sparkles />
                    {enhancing ? 'Enhancing…' : 'Enhance'}
                  </Button>
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
              <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-xs text-destructive">
                {error ?? enhanceError}
              </div>
            )}
            {view === 'enhanced' && degraded && (
              <div role="status" className="border-b border-warning/30 bg-warning/10 px-6 py-2 text-xs text-warning">
                Degraded result: structured enhancement failed, so this is a plain-text fallback.
              </div>
            )}

            {layoutMode === 'wide' ? (
              transcriptVisible ? (
              <ResizablePanelGroup
                direction="horizontal"
                autoSaveId="scribe:split"
                className="flex-1 overflow-hidden"
              >
                <ResizablePanel defaultSize={58} minSize={30} className="border-r border-border">
                  {/* The note surface owns its scroll container so the unified header
                      (NoteWindowHeader) can stay sticky while long notes scroll. */}
                  {renderNoteSurface()}
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={42} minSize={25} className="flex flex-col overflow-hidden p-6">
                  {/* Right column is transcript-only since V072 block 02 — chat lives
                      in the left column behind the unified header's Chat button. */}
                  <div className="min-h-0 flex-1">
                    <TranscriptPanel
                      finals={finals}
                      interims={interims}
                      highlight={highlight}
                      speakerNames={speakerNames}
                      onRenameSpeaker={onRenameSpeaker}
                      onReassignSegment={onReassignSegment}
                      distinctRawLabels={distinctRawLabels}
                    />
                  </div>
                  <details className="mt-4 text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">Capture diagnostics</summary>
                    <div className="mt-3">
                      <CaptureProbe controller={capture} />
                    </div>
                  </details>
                </ResizablePanel>
              </ResizablePanelGroup>
              ) : (
                // Transcript hidden — notes take the full width.
                <div className="flex-1 overflow-hidden">{renderNoteSurface()}</div>
              )
            ) : (
              // Narrow layout: a tab toolbar at the top lets the user swap between
              // Notes and Transcript. Chat is reached from the unified header's
              // Chat button inside the Notes surface (V072 block 02 — no more
              // separate Chat tab here).
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="border-b border-border px-4 py-2">
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={mainTab === 'chat' ? 'notes' : mainTab}
                    onValueChange={(v) => {
                      if (v) setMainTab(v as 'notes' | 'transcript');
                    }}
                  >
                    <ToggleGroupItem value="notes">Notes</ToggleGroupItem>
                    <ToggleGroupItem value="transcript">Transcript</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {mainTab === 'transcript' ? (
                    <div className="h-full overflow-y-auto p-4">
                      <TranscriptPanel
                        finals={finals}
                        interims={interims}
                        highlight={highlight}
                        speakerNames={speakerNames}
                        onRenameSpeaker={onRenameSpeaker}
                        onReassignSegment={onReassignSegment}
                        distinctRawLabels={distinctRawLabels}
                      />
                    </div>
                  ) : (
                    renderNoteSurface()
                  )}
                </div>
              </div>
            )}
          </>
        )}
        </main>
      </LayoutShell>
      )}
    </div>
  );
}
