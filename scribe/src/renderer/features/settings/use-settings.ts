import { useCallback, useEffect, useState } from 'react';
import type { SettingsView } from '../../../shared/ipc-contract';

export type SettingsController = {
  settings: SettingsView | null;
  refresh: () => Promise<void>;
};

// Loads the (key-free) settings view once on mount and exposes a refresh.
export function useSettings(): SettingsController {
  const [settings, setSettings] = useState<SettingsView | null>(null);

  const refresh = useCallback(async () => {
    setSettings(await window.api.settings.get());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { settings, refresh };
}
