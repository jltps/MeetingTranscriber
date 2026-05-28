import { useEffect, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { LanguageSetting, Template, TemplateCreate } from '../../../shared/types';
import type { SettingsView, WhisperModelStatus } from '../../../shared/ipc-contract';
import { TemplateEditorModal } from '../templates/TemplateEditorModal';
import { CalendarSettingsSection } from '../calendar/CalendarSettingsSection';
import { UpdatesSection } from './sections/UpdatesSection';
import { KeyRow } from './KeyRow';
import { OpenAiProviderRow } from './OpenAiProviderRow';
import { useTheme } from '../theme/use-theme';
import { estimateCost, formatAudioDuration, formatCost } from '../../../shared/pricing';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const THEME_MODES = ['system', 'light', 'dark'] as const;

// Sentinel for "use the system default mic" — distinct from any real deviceId
// (Chromium uses 'default'/'communications' as actual device ids).
const MIC_SYSTEM_DEFAULT = '__system__';

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'pt-PT', label: 'Portuguese (Portugal)' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
];

function langSettingToSelectValue(lang: LanguageSetting): string {
  return lang.mode === 'auto' ? 'auto' : lang.bcp47;
}

function selectValueToLangSetting(value: string): LanguageSetting {
  if (value === 'auto') return { mode: 'auto' };
  return { mode: 'fixed', bcp47: value };
}

type SettingsModalProps = {
  settings: SettingsView;
  templates: Template[];
  onClose: () => void;
  onChanged: () => void;
  onWiped: () => void;
};

export function SettingsModal({
  settings,
  templates,
  onClose,
  onChanged,
  onWiped,
}: SettingsModalProps) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [instructions, setInstructions] = useState(settings.globalInstructions);
  const { theme, setMode } = useTheme();

  // null = editor closed, 'new' = creating, Template = editing
  const [editorTarget, setEditorTarget] = useState<'new' | Template | null>(null);

  // Transcription provider + Whisper model manager (ROADMAP_05)
  const [provider, setProvider] = useState<'deepgram' | 'whisper'>(settings.transcriptionProvider);
  const [whisperModel, setWhisperModel] = useState(settings.whisperModel);
  const [modelStatuses, setModelStatuses] = useState<WhisperModelStatus[]>([]);
  const [activeDownload, setActiveDownload] = useState<string | null>(null);

  // Load model statuses on mount and subscribe to download progress.
  useEffect(() => {
    void window.api.whisper.getModels().then(setModelStatuses);
    const unsub = window.api.whisper.onDownloadProgress((e) => {
      if (e.done) {
        setActiveDownload(null);
        // Refresh statuses after a download completes or errors.
        void window.api.whisper.getModels().then(setModelStatuses);
      } else {
        setActiveDownload(e.name);
        setModelStatuses((prev) =>
          prev.map((m) =>
            m.name === e.name ? { ...m, state: 'downloading' as const, progress: e.pct } : m,
          ),
        );
      }
    });
    return unsub;
  }, []);

  const handleSetProvider = (p: 'deepgram' | 'whisper'): void => {
    setProvider(p);
    void window.api.settings.setTranscriptionProvider(p).then(onChanged);
  };

  const handleSetWhisperModel = (m: string): void => {
    setWhisperModel(m);
    void window.api.settings.setWhisperModel(m).then(onChanged);
  };

  // Backup / restore state (ROADMAP_04)
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const backupMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBackup = async (): Promise<void> => {
    setBackingUp(true);
    setBackupMsg(null);
    try {
      const result = await window.api.export.exportBackup();
      if (result.success) {
        setBackupMsg(`Saved ${result.meetingCount} meeting${result.meetingCount === 1 ? '' : 's'}.`);
        if (backupMsgTimer.current) clearTimeout(backupMsgTimer.current);
        backupMsgTimer.current = setTimeout(() => setBackupMsg(null), 4000);
      }
    } catch (e) {
      setBackupMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestore = async (): Promise<void> => {
    setRestoring(true);
    setRestoreMsg(null);
    try {
      const result = await window.api.export.exportRestore();
      if (result.success) {
        setRestoreMsg(`Restored ${result.meetingCount} meeting${result.meetingCount === 1 ? '' : 's'}. Reloading…`);
        // Short delay so the user sees the message before the modal closes.
        await new Promise<void>((r) => setTimeout(r, 800));
        onWiped(); // reuses the same refresh path as "Wipe all data"
      }
    } catch (e) {
      setRestoreMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRestoring(false);
    }
  };

  useEffect(() => {
    const load = (): void => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => setMics(devices.filter((d) => d.kind === 'audioinput' && d.deviceId)));
    };
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, []);

  const onWipe = async (): Promise<void> => {
    if (!window.confirm('Delete ALL local data — every meeting, note, transcript, and saved key? This cannot be undone.')) {
      return;
    }
    await window.api.settings.wipe();
    onWiped();
  };

  const handleEditorSave = async (data: TemplateCreate): Promise<void> => {
    if (editorTarget === 'new') {
      await window.api.templates.create(data);
    } else if (editorTarget !== null) {
      await window.api.templates.update(editorTarget.id, data);
    }
    onChanged();
  };

  return (
    <>
      {editorTarget !== null && (
        <TemplateEditorModal
          template={editorTarget === 'new' ? null : editorTarget}
          onSave={handleEditorSave}
          onClose={() => setEditorTarget(null)}
        />
      )}

      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="flex max-h-[85vh] w-full sm:max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-3 text-left">
            <DialogTitle className="text-base">Settings</DialogTitle>
            <DialogDescription className="sr-only">
              API keys, appearance, audio, transcription, enhancement, templates, usage, and data.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 overflow-y-auto p-5">
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">API keys</h3>
              <KeyRow label="Deepgram" provider="deepgram" isSet={settings.deepgramKeySet} onSaved={onChanged} />
              <KeyRow label="Anthropic" provider="anthropic" isSet={settings.anthropicKeySet} onSaved={onChanged} />
              <p className="text-[11px] text-muted-foreground">
                Keys are encrypted with your OS secure storage and never leave this machine.
              </p>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                AI provider
              </h3>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={settings.llmProvider}
                onValueChange={(v) => {
                  if (v) void window.api.settings.setLlmProvider(v as 'anthropic' | 'openai-compatible').then(onChanged);
                }}
              >
                <ToggleGroupItem value="anthropic">Anthropic (recommended)</ToggleGroupItem>
                <ToggleGroupItem value="openai-compatible">OpenAI-compatible</ToggleGroupItem>
              </ToggleGroup>
              {settings.llmProvider === 'openai-compatible' ? (
                <OpenAiProviderRow
                  baseUrl={settings.openaiBaseUrl}
                  model={settings.openaiModel}
                  keySet={settings.openaiKeySet}
                  onChanged={onChanged}
                />
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Enhancement, chat, titles, and prompt-optimization run on Anthropic Claude — the
                  models the app is tuned for.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Appearance
              </h3>
              <div className="space-y-1.5">
                <label className="text-sm text-foreground">Theme</label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={theme?.mode ?? 'system'}
                  onValueChange={(v) => { if (v) void setMode(v as (typeof THEME_MODES)[number]); }}
                >
                  {THEME_MODES.map((m) => (
                    <ToggleGroupItem key={m} value={m} className="capitalize">
                      {m}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-[11px] text-muted-foreground">
                  {theme ? `Currently ${theme.effective}. ` : ''}
                  &ldquo;System&rdquo; follows your OS appearance.
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audio</h3>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Microphone</label>
                <Select
                  value={settings.micDeviceId ?? MIC_SYSTEM_DEFAULT}
                  onValueChange={(v) => {
                    void window.api.settings
                      .setMicDevice(v === MIC_SYSTEM_DEFAULT ? null : v)
                      .then(onChanged);
                  }}
                >
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={MIC_SYSTEM_DEFAULT}>System default</SelectItem>
                    {mics.map((m, i) => (
                      <SelectItem key={m.deviceId} value={m.deviceId}>
                        {m.label || `Microphone ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Device names appear after the first capture. Make sure your system output device
                  matches the one your call plays through, or remote audio (CH1) won't be captured.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Listening on</label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={settings.audioCaptureMode}
                  onValueChange={(v) => {
                    if (v) void window.api.settings
                      .setAudioCaptureMode(v as 'auto' | 'headphones' | 'speakers')
                      .then(onChanged);
                  }}
                >
                  <ToggleGroupItem value="auto">Auto-detect</ToggleGroupItem>
                  <ToggleGroupItem value="headphones">Headphones</ToggleGroupItem>
                  <ToggleGroupItem value="speakers">Speakers</ToggleGroupItem>
                </ToggleGroup>
                <p className="text-[11px] text-muted-foreground">
                  Auto-detect measures whether your speakers are leaking into the mic and tightens
                  the &ldquo;Me&rdquo; threshold accordingly. Pick &ldquo;Headphones&rdquo; if
                  remote speakers ever get mis-tagged as you, or &ldquo;Speakers&rdquo; if your own
                  voice keeps getting split across speakers.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Transcription language</label>
                <Select
                  value={langSettingToSelectValue(settings.language)}
                  onValueChange={(v) => {
                    void window.api.settings.setLanguage(selectValueToLangSetting(v)).then(onChanged);
                  }}
                >
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Auto-detect uses nova-3 multilingual mode. For Portuguese or other languages,
                  selecting a fixed language gives the most accurate results.
                </p>
              </div>
            </section>

            {/* ── Transcription provider + local Whisper model manager ── */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Transcription
              </h3>

              {/* Provider toggle */}
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Provider</label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={provider}
                  onValueChange={(v) => { if (v) handleSetProvider(v as 'deepgram' | 'whisper'); }}
                >
                  <ToggleGroupItem value="deepgram">Deepgram (cloud)</ToggleGroupItem>
                  <ToggleGroupItem value="whisper">Local (Whisper)</ToggleGroupItem>
                </ToggleGroup>
                {provider === 'deepgram' && (
                  <p className="text-[11px] text-muted-foreground">
                    Streams audio to Deepgram&apos;s cloud API. Requires a Deepgram key (set above).
                  </p>
                )}
                {provider === 'whisper' && (
                  <p className="text-[11px] text-muted-foreground">
                    Transcribes on-device using whisper.cpp ONNX. No API key needed; audio never leaves
                    your machine. Latency ≈ 5 s per chunk.
                  </p>
                )}
              </div>

              {/* Local Whisper model manager */}
              {provider === 'whisper' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">Active model</label>
                    <Select value={whisperModel} onValueChange={handleSetWhisperModel}>
                      <SelectTrigger className="w-full" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(['tiny', 'base', 'small', 'medium'] as const).map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const active = modelStatuses.find((s) => s.name === whisperModel);
                      if (active && active.state !== 'ready') {
                        return (
                          <p className="text-[11px] text-warning">
                            Download &ldquo;{whisperModel}&rdquo; below before recording.
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  {/* Model status table */}
                  <div className="rounded-md border border-border divide-y divide-border">
                    {modelStatuses.map((m) => (
                      <div key={m.name} className="flex items-center justify-between px-3 py-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-foreground">ggml-{m.name}.bin</span>
                          <span className="text-muted-foreground">{formatBytes(m.sizeBytes)}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 ml-2">
                          {m.state === 'ready' && (
                            <>
                              <span className="flex items-center gap-1 text-primary">
                                <Check className="size-3" /> Ready
                              </span>
                              <Button
                                variant="ghost"
                                size="xs"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  void window.api.whisper.deleteModel(m.name).then(() =>
                                    window.api.whisper.getModels().then(setModelStatuses),
                                  );
                                }}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                          {m.state === 'downloading' && (
                            <>
                              <span className="text-muted-foreground">
                                {m.progress != null ? `${m.progress}%` : 'Starting…'}
                              </span>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => void window.api.whisper.cancelDownload()}
                              >
                                Cancel
                              </Button>
                            </>
                          )}
                          {m.state === 'not-downloaded' && (
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={activeDownload !== null}
                              onClick={() => {
                                setActiveDownload(m.name);
                                void window.api.whisper.downloadModel(m.name);
                              }}
                            >
                              Download
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <CalendarSettingsSection
              googleConnected={settings.googleCalendarConnected}
              microsoftConnected={settings.microsoftCalendarConnected}
              onChanged={onChanged}
            />

            <UpdatesSection />

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Enhancement
              </h3>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Custom instructions</label>
                <Textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  onBlur={() => {
                    void window.api.settings.setGlobalInstructions(instructions).then(onChanged);
                  }}
                  rows={4}
                  className="resize-none text-xs"
                  placeholder={
                    'e.g. "Always list action items with an owner and due date." ' +
                    '"Write in European Portuguese." "Executive summary, no preamble."'
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  Applied to every enhancement as advisory guidance. Cannot change the output format
                  or remove source-linking (those are enforced by the system).
                </p>
              </div>

              {/* Cost/quality tiering applies to Anthropic only — the OpenAI-compatible
                  provider uses its single configured model for every task (V06 block 05). */}
              {settings.llmProvider === 'anthropic' && (
                <div className="space-y-1.5">
                  <label className="text-sm text-muted-foreground">Cost &amp; quality</label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={settings.qualityMode}
                    onValueChange={(v) => {
                      if (v) void window.api.settings.setQualityMode(v as 'economy' | 'quality').then(onChanged);
                    }}
                  >
                    <ToggleGroupItem value="quality">Quality</ToggleGroupItem>
                    <ToggleGroupItem value="economy">Economy</ToggleGroupItem>
                  </ToggleGroup>
                  <p className="text-[11px] text-muted-foreground">
                    Quality uses the stronger model for enhancement and chat. Economy uses a faster,
                    cheaper model for them. Titles and summaries always use the cheaper model.
                  </p>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Templates
                </h3>
                <Button variant="ghost" size="xs" onClick={() => setEditorTarget('new')}>
                  <Plus /> New template
                </Button>
              </div>

              {/* Template list — all rows are read-only; Edit opens the editor modal */}
              <div className="space-y-1.5">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start justify-between rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-foreground">{t.name}</span>
                      {t.instructions && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
                          {t.instructions}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1 ml-2">
                      <Button variant="link" size="xs" onClick={() => setEditorTarget(t)}>
                        Edit
                      </Button>
                      <Button
                        variant="link"
                        size="xs"
                        className="text-destructive"
                        onClick={() => {
                          if (window.confirm(`Delete template "${t.name}"?`)) {
                            void window.api.templates.remove(t.id).then(onChanged);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Usage &amp; Cost
              </h3>
              {(() => {
                const t = settings.usageTotals;
                const hasAny = t.deepgramAudioMs > 0 || t.claudeInputTokens > 0;
                if (!hasAny) {
                  return (
                    <p className="text-[11px] text-muted-foreground">
                      No usage recorded yet. Cost will appear after your first transcription and enhancement.
                    </p>
                  );
                }
                // Deepgram cost comes from main (channel-weighted across meetings —
                // can't be derived from summed ms alone, V05 ROADMAP_02). The LLM dollar
                // figure is Anthropic-priced, so we only show it (and fold it into Total)
                // when Anthropic is the active provider (V06 block 05) — no fake numbers.
                const isAnthropic = settings.llmProvider === 'anthropic';
                const deepgramCost = t.deepgramCostUsd;
                const claudeCost = estimateCost(0, t.claudeInputTokens, t.claudeOutputTokens);
                const totalCost = isAnthropic ? t.estimatedCostUsd : deepgramCost;
                return (
                  <div className="space-y-2">
                    <div className="rounded-md border border-border divide-y divide-border text-xs">
                      {t.deepgramAudioMs > 0 && (
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-muted-foreground">
                            Deepgram transcription
                            <span className="ml-1.5 text-muted-foreground">
                              {formatAudioDuration(t.deepgramAudioMs)}
                            </span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">{formatCost(deepgramCost)}</span>
                        </div>
                      )}
                      {t.claudeInputTokens > 0 && (
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-muted-foreground">
                            {isAnthropic ? 'Claude enhancement' : 'AI enhancement'}
                            <span className="ml-1.5 text-muted-foreground">
                              {(t.claudeInputTokens + t.claudeOutputTokens).toLocaleString()} tokens
                            </span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {isAnthropic ? formatCost(claudeCost) : '—'}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between px-3 py-2 font-medium">
                        <span className="text-muted-foreground">Total</span>
                        <span className="tabular-nums text-foreground">{formatCost(totalCost)}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {isAnthropic
                        ? 'Estimates based on standard list pricing. Actual charges depend on your Deepgram and Anthropic account terms.'
                        : 'Transcription cost is estimated from Deepgram list pricing. A dollar estimate is not available for custom OpenAI-compatible providers — see your provider for token pricing.'}
                    </p>
                  </div>
                );
              })()}
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data</h3>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Back up all your meetings to a JSON file, or restore from a previous backup.
                Restore replaces all current meetings — settings and API keys are not affected.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleBackup()}
                  disabled={backingUp || restoring}
                >
                  {backingUp ? 'Saving…' : 'Backup all meetings…'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRestore()}
                  disabled={backingUp || restoring}
                >
                  {restoring ? 'Restoring…' : 'Restore from backup…'}
                </Button>
              </div>
              {backupMsg && <p className="text-[11px] text-primary">{backupMsg}</p>}
              {restoreMsg && (
                <p className={`text-[11px] ${restoreMsg.startsWith('Error') ? 'text-destructive' : 'text-primary'}`}>
                  {restoreMsg}
                </p>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Privacy</h3>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                No audio is ever stored. Audio is streamed to Deepgram for transcription and dropped;
                transcript text and notes go to Anthropic only when you enhance a meeting. Everything
                else stays local.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void onWipe()}
              >
                Wipe all local data
              </Button>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
