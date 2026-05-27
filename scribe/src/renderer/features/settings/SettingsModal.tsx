import { useEffect, useRef, useState } from 'react';
import type { LanguageSetting, Template, TemplateCreate } from '../../../shared/types';
import type { SettingsView, TestProvider, TestResult, WhisperModelStatus } from '../../../shared/ipc-contract';
import { TemplateEditorModal } from '../templates/TemplateEditorModal';
import { CalendarSettingsSection } from '../calendar/CalendarSettingsSection';
import { useTheme } from '../theme/use-theme';
import { estimateCost, formatAudioDuration, formatCost } from '../../../shared/pricing';

const THEME_MODES = ['system', 'light', 'dark'] as const;

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

type KeyRowProps = {
  label: string;
  provider: TestProvider;
  isSet: boolean;
  onSaved: () => void;
};

function KeyRow({ label, provider, isSet, onSaved }: KeyRowProps) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setResult(null);
    try {
      await window.api.settings.setKeys(
        provider === 'deepgram' ? { deepgram: value } : { anthropic: value },
      );
      setValue('');
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    setResult(null);
    try {
      // Test the key in the box if there is one; otherwise test the saved key.
      setResult(await window.api.settings.test(provider, value.trim() || undefined));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm text-muted-foreground">{label}</label>
        <span className={`text-[11px] ${isSet ? 'text-primary' : 'text-muted-foreground'}`}>
          {isSet ? 'key saved' : 'not set'}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          placeholder={isSet ? 'Enter a new key to replace' : 'Paste API key'}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || value.trim() === ''}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => void test()}
          disabled={testing || (value.trim() === '' && !isSet)}
          className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
      {result && (
        <p className={`text-[11px] ${result.ok ? 'text-primary' : 'text-destructive'}`}>
          {result.ok ? 'Connection OK' : (result.message ?? 'Connection failed')}
        </p>
      )}
    </div>
  );
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
        .then((devices) => setMics(devices.filter((d) => d.kind === 'audioinput')));
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

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
        <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold text-foreground">Settings</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Close
            </button>
          </div>

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
                Appearance
              </h3>
              <div className="space-y-1.5">
                <label className="text-sm text-foreground">Theme</label>
                <div className="flex gap-2">
                  {THEME_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => void setMode(m)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                        (theme?.mode ?? 'system') === m
                          ? 'border-primary bg-secondary text-secondary-foreground'
                          : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
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
                <select
                  value={settings.micDeviceId ?? ''}
                  onChange={(e) => {
                    void window.api.settings.setMicDevice(e.target.value || null).then(onChanged);
                  }}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none"
                >
                  <option value="">System default</option>
                  {mics.map((m, i) => (
                    <option key={m.deviceId || i} value={m.deviceId}>
                      {m.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Device names appear after the first capture. Make sure your system output device
                  matches the one your call plays through, or remote audio (CH1) won't be captured.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Transcription language</label>
                <select
                  value={langSettingToSelectValue(settings.language)}
                  onChange={(e) => {
                    void window.api.settings
                      .setLanguage(selectValueToLangSetting(e.target.value))
                      .then(onChanged);
                  }}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none"
                >
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
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
                <div className="flex gap-2">
                  {(['deepgram', 'whisper'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleSetProvider(p)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        provider === p
                          ? 'border-primary bg-secondary text-foreground'
                          : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {p === 'deepgram' ? 'Deepgram (cloud)' : 'Local (Whisper)'}
                    </button>
                  ))}
                </div>
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
                    <select
                      value={whisperModel}
                      onChange={(e) => handleSetWhisperModel(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none"
                    >
                      {(['tiny', 'base', 'small', 'medium'] as const).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const active = modelStatuses.find((s) => s.name === whisperModel);
                      if (!active) return null;
                      if (active.state !== 'ready') {
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
                              <span className="text-primary">✓ Ready</span>
                              <button
                                type="button"
                                onClick={() => {
                                  void window.api.whisper.deleteModel(m.name).then(() =>
                                    window.api.whisper.getModels().then(setModelStatuses),
                                  );
                                }}
                                className="text-[10px] text-destructive hover:text-destructive"
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {m.state === 'downloading' && (
                            <>
                              <span className="text-muted-foreground">
                                {m.progress != null ? `${m.progress}%` : 'Starting…'}
                              </span>
                              <button
                                type="button"
                                onClick={() => void window.api.whisper.cancelDownload()}
                                className="text-[10px] text-muted-foreground hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {m.state === 'not-downloaded' && (
                            <button
                              type="button"
                              disabled={activeDownload !== null}
                              onClick={() => {
                                setActiveDownload(m.name);
                                void window.api.whisper.downloadModel(m.name);
                              }}
                              className="rounded border border-input px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-40"
                            >
                              Download
                            </button>
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

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Enhancement
              </h3>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Custom instructions</label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  onBlur={() => {
                    void window.api.settings.setGlobalInstructions(instructions).then(onChanged);
                  }}
                  rows={4}
                  placeholder={
                    'e.g. "Always list action items with an owner and due date." ' +
                    '"Write in European Portuguese." "Executive summary, no preamble."'
                  }
                  className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                />
                <p className="text-[11px] text-muted-foreground">
                  Applied to every enhancement as advisory guidance. Cannot change the output format
                  or remove source-linking (those are enforced by the system).
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Templates
                </h3>
                <button
                  type="button"
                  onClick={() => setEditorTarget('new')}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  + New template
                </button>
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
                      <button
                        type="button"
                        onClick={() => setEditorTarget(t)}
                        className="text-[10px] text-muted-foreground hover:text-muted-foreground"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete template "${t.name}"?`)) {
                            void window.api.templates.remove(t.id).then(onChanged);
                          }
                        }}
                        className="text-[10px] text-destructive hover:text-destructive"
                      >
                        Delete
                      </button>
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
                const deepgramCost = estimateCost(t.deepgramAudioMs, 0, 0);
                const claudeCost = estimateCost(0, t.claudeInputTokens, t.claudeOutputTokens);
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
                            Claude enhancement
                            <span className="ml-1.5 text-muted-foreground">
                              {(t.claudeInputTokens + t.claudeOutputTokens).toLocaleString()} tokens
                            </span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">{formatCost(claudeCost)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between px-3 py-2 font-medium">
                        <span className="text-muted-foreground">Total</span>
                        <span className="tabular-nums text-foreground">{formatCost(t.estimatedCostUsd)}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Estimates based on standard list pricing. Actual charges depend on your Deepgram
                      and Anthropic account terms.
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
                <button
                  type="button"
                  onClick={() => void handleBackup()}
                  disabled={backingUp || restoring}
                  className="rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {backingUp ? 'Saving…' : 'Backup all meetings…'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRestore()}
                  disabled={backingUp || restoring}
                  className="rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {restoring ? 'Restoring…' : 'Restore from backup…'}
                </button>
              </div>
              {backupMsg && (
                <p className="text-[11px] text-primary">{backupMsg}</p>
              )}
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
              <button
                type="button"
                onClick={() => void onWipe()}
                className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                Wipe all local data
              </button>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
