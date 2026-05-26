import { useState } from 'react';

// Settings → Calendar section (ROADMAP_06). Connect/disconnect Google Calendar.
// OAuth happens in the system browser (driven by the main process); this just
// kicks it off and reflects the connected state. Tokens never reach the renderer.

type CalendarSettingsSectionProps = {
  googleConnected: boolean;
  /** Refresh the settings view after a connection change. */
  onChanged: () => void;
};

export function CalendarSettingsSection({ googleConnected, onChanged }: CalendarSettingsSectionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await window.api.calendar.connect('google');
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
      await window.api.calendar.disconnect('google');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Calendar</h3>
      <p className="text-[11px] text-neutral-500">
        Connect a read-only calendar to see upcoming meetings and auto-start recording at their
        scheduled time. Scribe never joins the call.
      </p>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-neutral-300">Google Calendar</span>
        {googleConnected ? (
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-emerald-400">✓ Connected</span>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={busy}
              className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Connect with Google'}
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </section>
  );
}
