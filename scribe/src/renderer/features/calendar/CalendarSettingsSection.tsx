import { useState } from 'react';
import type { CalendarProviderId } from '../../../shared/types';

// Settings → Calendar section (ROADMAP_06). Connect/disconnect each calendar
// provider. OAuth happens in the system browser (driven by the main process);
// this just kicks it off and reflects the connected state. Tokens never reach
// the renderer.

type ProviderRowProps = {
  providerId: CalendarProviderId;
  label: string;
  connected: boolean;
  onChanged: () => void;
};

function ProviderRow({ providerId, label, connected, onChanged }: ProviderRowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await window.api.calendar.connect(providerId);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await window.api.calendar.disconnect(providerId);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        {connected ? (
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-primary">✓ Connected</span>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={busy}
              className="text-[10px] text-destructive hover:text-destructive disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            className="rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {busy ? 'Connecting…' : `Connect with ${label.split(' ')[0]}`}
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

type CalendarSettingsSectionProps = {
  googleConnected: boolean;
  microsoftConnected: boolean;
  /** Refresh the settings view after a connection change. */
  onChanged: () => void;
};

export function CalendarSettingsSection({
  googleConnected,
  microsoftConnected,
  onChanged,
}: CalendarSettingsSectionProps) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Calendar</h3>
      <p className="text-[11px] text-muted-foreground">
        Connect a calendar to see upcoming meetings and auto-start recording at their scheduled
        time. Scribe reads only your busy times — never event titles — and never joins the call.
      </p>

      <ProviderRow
        providerId="google"
        label="Google Calendar"
        connected={googleConnected}
        onChanged={onChanged}
      />
      <ProviderRow
        providerId="microsoft"
        label="Microsoft Outlook"
        connected={microsoftConnected}
        onChanged={onChanged}
      />
    </section>
  );
}
