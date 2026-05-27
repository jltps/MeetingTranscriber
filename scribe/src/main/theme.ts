import { BrowserWindow, nativeTheme } from 'electron';
import type { ThemeMode, ThemeView } from '../shared/ipc-contract';
import { getThemeMode, setThemeMode } from './db/settings';

// Appearance / theming (ROADMAP_V04_01). The renderer applies colours purely via
// prefers-color-scheme (see renderer/app/index.css); we make that media query
// reflect the user's choice by setting nativeTheme.themeSource here in main. Doing
// it before the window loads means the very first paint is already correct — no
// FOUC, and no inline script (which the prod CSP `script-src 'self'` would block).

// Window background colours — kept in sync with --background in index.css so the
// native frame never flashes the wrong colour before the renderer paints.
const BACKGROUND = { dark: '#0a0a0a', light: '#fafafa' } as const;

export function effectiveTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

export function themeView(): ThemeView {
  return { mode: getThemeMode(), effective: effectiveTheme() };
}

function backgroundColor(): string {
  return BACKGROUND[effectiveTheme()];
}

/** Push the persisted mode into Chromium. Call once on startup, before createWindow. */
export function initTheme(): void {
  nativeTheme.themeSource = getThemeMode();
}

/** Persist a new mode and apply it live. Returns the resolved view. */
export function applyThemeMode(mode: ThemeMode): ThemeView {
  setThemeMode(mode);
  nativeTheme.themeSource = mode;
  return themeView();
}

/** Initial background for a window (read at creation time). */
export function initialBackgroundColor(): string {
  return backgroundColor();
}

/**
 * Keep a window's native background in step with the effective theme. Fires when
 * the OS theme flips while in 'system' mode, or when the user switches modes.
 * (Block 03 will extend this hook to re-colour the title-bar overlay.)
 */
export function registerThemeWindow(win: BrowserWindow): void {
  const update = (): void => {
    if (!win.isDestroyed()) win.setBackgroundColor(backgroundColor());
  };
  nativeTheme.on('updated', update);
  win.on('closed', () => nativeTheme.removeListener('updated', update));
}
