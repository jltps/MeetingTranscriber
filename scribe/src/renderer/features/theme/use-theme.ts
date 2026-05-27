import { useCallback, useEffect, useState } from 'react';
import type { ThemeMode, ThemeView } from '../../../shared/ipc-contract';

export type ThemeController = {
  /** Null until the first load resolves. */
  theme: ThemeView | null;
  setMode: (mode: ThemeMode) => Promise<void>;
};

// Appearance state for the renderer (ROADMAP_V04_01). Colours are applied purely
// by prefers-color-scheme (main drives it via nativeTheme.themeSource), so this
// hook never touches the DOM — it just reads the current mode for the UI and
// writes new ones through IPC. It also tracks the OS media query so the
// "effective" label stays fresh when the system flips while in 'system' mode.
export function useTheme(): ThemeController {
  const [theme, setTheme] = useState<ThemeView | null>(null);

  useEffect(() => {
    void window.api.theme.get().then(setTheme);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      setTheme((prev) =>
        prev ? { ...prev, effective: mq.matches ? 'dark' : 'light' } : prev,
      );
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setMode = useCallback(async (mode: ThemeMode) => {
    setTheme(await window.api.theme.set(mode));
  }, []);

  return { theme, setMode };
}
