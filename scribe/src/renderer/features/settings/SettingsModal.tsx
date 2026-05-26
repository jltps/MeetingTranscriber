import { useEffect, useState } from 'react';
import type { LanguageSetting, Template, TemplateCreate } from '../../../shared/types';
import type { SettingsView, TestProvider, TestResult } from '../../../shared/ipc-contract';
import { TemplateEditorModal } from '../templates/TemplateEditorModal';
import { estimateCost, formatAudioDuration, formatCost } from '../../../shared/pricing';

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
        <label className="text-sm text-neutral-300">{label}</label>
        <span className={`text-[11px] ${isSet ? 'text-emerald-400' : 'text-neutral-500'}`}>
          {isSet ? 'key saved' : 'not set'}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          placeholder={isSet ? 'Enter a new key to replace' : 'Paste API key'}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || value.trim() === ''}
          className="rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => void test()}
          disabled={testing || (value.trim() === '' && !isSet)}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
      {result && (
        <p className={`text-[11px] ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>
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

  // null = editor closed, 'new' = creating, Template = editing
  const [editorTarget, setEditorTarget] = useState<'new' | Template | null>(null);

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
        <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
            <h2 className="text-base font-semibold text-neutral-100">Settings</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              Close
            </button>
          </div>

          <div className="space-y-6 overflow-y-auto p-5">
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">API keys</h3>
              <KeyRow label="Deepgram" provider="deepgram" isSet={settings.deepgramKeySet} onSaved={onChanged} />
              <KeyRow label="Anthropic" provider="anthropic" isSet={settings.anthropicKeySet} onSaved={onChanged} />
              <p className="text-[11px] text-neutral-500">
                Keys are encrypted with your OS secure storage and never leave this machine.
              </p>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Audio</h3>
              <div className="space-y-1.5">
                <label className="text-sm text-neutral-300">Microphone</label>
                <select
                  value={settings.micDeviceId ?? ''}
                  onChange={(e) => {
                    void window.api.settings.setMicDevice(e.target.value || null).then(onChanged);
                  }}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none"
                >
                  <option value="">System default</option>
                  {mics.map((m, i) => (
                    <option key={m.deviceId || i} value={m.deviceId}>
                      {m.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-neutral-500">
                  Device names appear after the first capture. Make sure your system output device
                  matches the one your call plays through, or remote audio (CH1) won't be captured.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-neutral-300">Transcription language</label>
                <select
                  value={langSettingToSelectValue(settings.language)}
                  onChange={(e) => {
                    void window.api.settings
                      .setLanguage(selectValueToLangSetting(e.target.value))
                      .then(onChanged);
                  }}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none"
                >
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-neutral-500">
                  Auto-detect uses nova-3 multilingual mode. For Portuguese or other languages,
                  selecting a fixed language gives the most accurate results.
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Enhancement
              </h3>
              <div className="space-y-1.5">
                <label className="text-sm text-neutral-300">Custom instructions</label>
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
                  className="w-full resize-none rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                />
                <p className="text-[11px] text-neutral-500">
                  Applied to every enhancement as advisory guidance. Cannot change the output format
                  or remove source-linking (those are enforced by the system).
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Templates
                </h3>
                <button
                  type="button"
                  onClick={() => setEditorTarget('new')}
                  className="text-[11px] text-neutral-400 hover:text-neutral-200"
                >
                  + New template
                </button>
              </div>

              {/* Template list — all rows are read-only; Edit opens the editor modal */}
              <div className="space-y-1.5">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start justify-between rounded-md border border-neutral-800 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-neutral-200">{t.name}</span>
                      {t.instructions && (
                        <p className="mt-0.5 text-[10px] text-neutral-500 line-clamp-1">
                          {t.instructions}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1 ml-2">
                      <button
                        type="button"
                        onClick={() => setEditorTarget(t)}
                        className="text-[10px] text-neutral-500 hover:text-neutral-300"
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
                        className="text-[10px] text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Usage &amp; Cost
              </h3>
              {(() => {
                const t = settings.usageTotals;
                const hasAny = t.deepgramAudioMs > 0 || t.claudeInputTokens > 0;
                if (!hasAny) {
                  return (
                    <p className="text-[11px] text-neutral-500">
                      No usage recorded yet. Cost will appear after your first transcription and enhancement.
                    </p>
                  );
                }
                const deepgramCost = estimateCost(t.deepgramAudioMs, 0, 0);
                const claudeCost = estimateCost(0, t.claudeInputTokens, t.claudeOutputTokens);
                return (
                  <div className="space-y-2">
                    <div className="rounded-md border border-neutral-800 divide-y divide-neutral-800 text-xs">
                      {t.deepgramAudioMs > 0 && (
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-neutral-400">
                            Deepgram transcription
                            <span className="ml-1.5 text-neutral-600">
                              {formatAudioDuration(t.deepgramAudioMs)}
                            </span>
                          </span>
                          <span className="tabular-nums text-neutral-300">{formatCost(deepgramCost)}</span>
                        </div>
                      )}
                      {t.claudeInputTokens > 0 && (
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-neutral-400">
                            Claude enhancement
                            <span className="ml-1.5 text-neutral-600">
                              {(t.claudeInputTokens + t.claudeOutputTokens).toLocaleString()} tokens
                            </span>
                          </span>
                          <span className="tabular-nums text-neutral-300">{formatCost(claudeCost)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between px-3 py-2 font-medium">
                        <span className="text-neutral-300">Total</span>
                        <span className="tabular-nums text-neutral-200">{formatCost(t.estimatedCostUsd)}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-neutral-600">
                      Estimates based on standard list pricing. Actual charges depend on your Deepgram
                      and Anthropic account terms.
                    </p>
                  </div>
                );
              })()}
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Privacy</h3>
              <p className="text-[11px] leading-relaxed text-neutral-400">
                No audio is ever stored. Audio is streamed to Deepgram for transcription and dropped;
                transcript text and notes go to Anthropic only when you enhance a meeting. Everything
                else stays local.
              </p>
              <button
                type="button"
                onClick={() => void onWipe()}
                className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10"
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
