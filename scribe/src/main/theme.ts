import { BrowserWindow, nativeTheme } from 'electron';
import type { TitleBarOverlay } from 'electron';
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
// Foreground (mirrors --foreground) — used as the title-bar overlay symbol colour.
const FOREGROUND = { dark: '#e5e5e5', light: '#171717' } as const;

// The frameless title bar (ROADMAP_V04_03). The renderer's TitleBar height (h-10)
// MUST match this so the OS-drawn window controls align vertically.
export const TITLEBAR_HEIGHT = 40;

/** Window Controls Overlay config, themed to the effective theme. Windows/Linux only. */
export function overlayConfig(): TitleBarOverlay {
  const t = effectiveTheme();
  return { color: BACKGROUND[t], symbolColor: FOREGROUND[t], height: TITLEBAR_HEIGHT };
}

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
 * Keep a window's native chrome in step with the effective theme. Fires when the
 * OS theme flips while in 'system' mode, or when the user switches modes — recolours
 * both the window background and the title-bar overlay controls (ROADMAP_V04_03).
 */
export function registerThemeWindow(win: BrowserWindow): void {
  const update = (): void => {
    if (win.isDestroyed()) return;
    win.setBackgroundColor(backgroundColor());
    // titleBarOverlay is Windows/Linux only; macOS is out of scope (§12).
    if (process.platform !== 'darwin') win.setTitleBarOverlay(overlayConfig());
  };
  nativeTheme.on('updated', update);
  win.on('closed', () => nativeTheme.removeListener('updated', update));
}
