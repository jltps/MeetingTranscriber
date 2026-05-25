import { useEffect, useState } from 'react';
import type { AppStatus } from '../../shared/ipc-contract';

// M0 skeleton: a blank sidebar + empty editor pane. The status badge round-trips
// renderer -> preload -> ipcMain -> SQLite to prove the bridge and DB are wired.
// Real meeting list (M3) and notes editor (M3) replace these placeholders later.
export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    window.api
      .getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-200">
      <aside className="flex w-72 flex-col border-r border-neutral-800 bg-neutral-900">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <span className="text-sm font-semibold tracking-wide">Scribe</span>
          <button
            type="button"
            className="rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
          >
            New Note
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-500">
          No meetings yet
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
          <h1 className="text-base font-medium text-neutral-400">Untitled meeting</h1>
          <span className="text-[11px] text-neutral-600">
            {status
              ? `${status.platform} · v${status.appVersion} · db v${status.dbSchemaVersion}`
              : 'connecting…'}
          </span>
        </header>
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-neutral-600">
          Notes editor coming in M3
        </div>
      </main>
    </div>
  );
}
