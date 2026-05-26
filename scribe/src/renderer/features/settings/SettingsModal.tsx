import { useEffect, useState } from 'react';
import type { SettingsView, TestProvider, TestResult } from '../../../shared/ipc-contract';

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
  onClose: () => void;
  onChanged: () => void;
  onWiped: () => void;
};

export function SettingsModal({ settings, onClose, onChanged, onWiped }: SettingsModalProps) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);

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

  return (
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
                matches the one your call plays through, or remote audio (CH1) won’t be captured.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-neutral-300">Transcription language</label>
              <select
                value={settings.language}
                onChange={(e) => {
                  void window.api.settings.setLanguage(e.target.value).then(onChanged);
                }}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none"
              >
                <option value="en">English</option>
                <option value="auto">Auto-detect</option>
              </select>
            </div>
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
  );
}
