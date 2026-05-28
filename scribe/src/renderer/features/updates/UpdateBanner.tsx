import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUpdateState } from './useUpdateState';

// Sticky in-app banner shown when an update has been downloaded and is ready
// to install (V07 block 02). The "Restart now" button asks main to
// quitAndInstall, which refuses while a transcription session is active
// (§1.5) — in that case the banner copy swaps to a deferred message.
//
// Visual language matches the existing inline notices in App.tsx (err/warn
// strips below the meeting header): `border-b bg-*/10 px-6 py-2 text-xs`.
export function UpdateBanner() {
  const state = useUpdateState();
  const [dismissed, setDismissed] = useState(false);
  const [deferredMessage, setDeferredMessage] = useState<string | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  // ESC dismisses the banner for this session (same behaviour as the X button).
  useEffect(() => {
    if (state.phase !== 'downloaded' || dismissed) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDismissed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.phase, dismissed]);

  if (state.phase !== 'downloaded' || dismissed) return null;

  const onRestart = async (): Promise<void> => {
    const result = await window.api.updates.install();
    if (result.ok) return;
    if (result.reason === 'recording') {
      setDeferredMessage(
        'Restart to update will happen when your meeting ends.',
      );
    } else {
      setDeferredMessage(result.message ?? 'Could not install the update.');
    }
  };

  return (
    <div
      ref={bannerRef}
      role="status"
      className="border-b border-primary/30 bg-primary/10 px-6 py-2 text-xs text-foreground"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1">
          {deferredMessage ?? `Update ready (v${state.version}) — restart to install.`}
        </span>
        <Button size="xs" onClick={() => void onRestart()}>
          Restart now
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setDismissed(true)} aria-label="Dismiss update banner">
          Later
        </Button>
      </div>
    </div>
  );
}
