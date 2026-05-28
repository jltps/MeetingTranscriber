import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UpdateSettings, UpdateState } from '../../../../shared/ipc-contract';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useUpdateState } from '../../updates/useUpdateState';

// Settings → Updates (V07 block 02). Surfaces the updater's current state, the
// auto-update toggle, "Check now", and any release notes. Mirrors the inline
// `<section>` layout used by the other SettingsModal sections.

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function statusLine(state: UpdateState, lastChecked: string | null): string {
  switch (state.phase) {
    case 'idle':
      return lastChecked
        ? `Last checked ${formatTimestamp(lastChecked)}.`
        : 'Not checked yet.';
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `Downloading v${state.version}…`;
    case 'downloading':
      return `Downloading v${state.version}… ${Math.round(state.percent)}%`;
    case 'downloaded':
      return `v${state.version} ready to install.`;
    case 'none':
      return `Up to date. Last checked ${formatTimestamp(state.checkedAt)}.`;
    case 'error':
      return `Couldn't check for updates: ${state.message}`;
  }
}

export function UpdatesSection() {
  const state = useUpdateState();
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    void window.api.getStatus().then((s) => setAppVersion(s.appVersion));
  }, []);

  const refreshSettings = (): void => {
    void window.api.updates.getSettings().then(setSettings);
  };

  useEffect(() => {
    refreshSettings();
  }, []);
  // Refresh settings whenever a check completes (last-checked may have moved).
  useEffect(() => {
    if (state.phase === 'none' || state.phase === 'available') refreshSettings();
  }, [state.phase]);

  const busy = state.phase === 'checking' || state.phase === 'downloading';
  const releaseNotes =
    (state.phase === 'available' || state.phase === 'downloaded')
      ? state.releaseNotes
      : undefined;

  const onCheckNow = async (): Promise<void> => {
    setInstallError(null);
    await window.api.updates.checkNow();
  };

  const onInstall = async (): Promise<void> => {
    setInstallError(null);
    const r = await window.api.updates.install();
    if (!r.ok) {
      if (r.reason === 'recording') {
        setInstallError('A meeting is recording. Stop it first to install the update.');
      } else {
        setInstallError(r.message ?? 'Could not install the update.');
      }
    }
  };

  const onToggleAuto = (v: string): void => {
    if (v !== 'on' && v !== 'off') return;
    const next = v === 'on';
    void window.api.updates.setAutoEnabled(next).then(refreshSettings);
  };

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Updates
      </h3>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-foreground">Current version</span>
          <span className="text-xs text-muted-foreground">Nexus v{appVersion}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">{statusLine(state, settings?.lastChecked ?? null)}</p>
        {state.phase === 'downloading' && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.percent)}
            className="h-1 w-full overflow-hidden rounded bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{ width: `${state.percent}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void onCheckNow()} disabled={busy}>
          {state.phase === 'checking' ? 'Checking…' : 'Check now'}
        </Button>
        {state.phase === 'downloaded' && (
          <Button size="sm" onClick={() => void onInstall()}>
            Restart now
          </Button>
        )}
      </div>
      {installError && <p className="text-[11px] text-destructive">{installError}</p>}

      <div className="space-y-1.5">
        <label className="text-sm text-muted-foreground">Automatic updates</label>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={settings ? (settings.autoEnabled ? 'on' : 'off') : 'on'}
          onValueChange={onToggleAuto}
        >
          <ToggleGroupItem value="on">On</ToggleGroupItem>
          <ToggleGroupItem value="off">Off</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-[11px] text-muted-foreground">
          When on, Nexus checks for updates in the background and downloads them silently. You can
          always trigger a check manually above.
        </p>
      </div>

      {releaseNotes && (
        <div className="space-y-1.5">
          <label className="text-sm text-muted-foreground">Release notes</label>
          <div className="chat-md max-h-48 overflow-auto rounded border border-border bg-muted/30 p-3 text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{releaseNotes}</ReactMarkdown>
          </div>
        </div>
      )}
    </section>
  );
}
