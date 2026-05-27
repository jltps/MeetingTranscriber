import { BrowserWindow, screen } from 'electron';
import { getSetting, setSetting } from './db/settings';

// Window size/position/maximized persistence (ROADMAP_V04_06). Stored in the
// settings table as JSON; restored (clamped to a visible display) before the window
// shows so there's no resize flash. Main-process only — the renderer never sees this.

const KEY = 'window_state';
const DEFAULT = { width: 1100, height: 720 };
const MIN_WIDTH = 480;
const MIN_HEIGHT = 480;

type WindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
};

function read(): WindowState | null {
  const raw = getSetting(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<WindowState>;
    if (typeof s.width !== 'number' || typeof s.height !== 'number') return null;
    return {
      x: typeof s.x === 'number' ? s.x : undefined,
      y: typeof s.y === 'number' ? s.y : undefined,
      width: s.width,
      height: s.height,
      maximized: Boolean(s.maximized),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the BrowserWindow constructor bounds: the restored size clamped to fit a
 * visible display's work area (handles an unplugged monitor or shrunk resolution).
 * Returns size only; the x/y are applied here when they land on a real display.
 */
export function initialWindowBounds(): {
  width: number;
  height: number;
  x?: number;
  y?: number;
} {
  const s = read();
  if (!s) return { ...DEFAULT };

  // Pick the display nearest the saved position (falls back to primary).
  const display =
    s.x !== undefined && s.y !== undefined
      ? screen.getDisplayNearestPoint({ x: s.x, y: s.y })
      : screen.getPrimaryDisplay();
  const area = display.workArea;

  const width = Math.max(MIN_WIDTH, Math.min(s.width, area.width));
  const height = Math.max(MIN_HEIGHT, Math.min(s.height, area.height));

  // Only keep x/y if the window's top-left would sit within the chosen work area.
  let x: number | undefined;
  let y: number | undefined;
  if (s.x !== undefined && s.y !== undefined) {
    const inX = s.x >= area.x && s.x + width <= area.x + area.width;
    const inY = s.y >= area.y && s.y + height <= area.y + area.height;
    if (inX && inY) {
      x = s.x;
      y = s.y;
    }
  }
  return { width, height, x, y };
}

/** Whether the last session was maximized (apply after the window is created). */
export function wasMaximized(): boolean {
  return read()?.maximized ?? false;
}

export const MIN_SIZE = { minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT };

/**
 * Restore maximized state and start tracking. Debounced saves on resize/move; a
 * final authoritative write on close. The normal (non-maximized) bounds are saved
 * so un-maximizing restores a sensible size.
 */
export function registerWindowState(win: BrowserWindow): void {
  if (wasMaximized()) win.maximize();

  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = (): void => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    // getNormalBounds() is the un-maximized rect, so a maximized session still
    // restores to a usable size when later un-maximized.
    const b = win.getNormalBounds();
    setSetting(
      KEY,
      JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized }),
    );
  };

  const debouncedSave = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };

  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('maximize', save);
  win.on('unmaximize', save);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}
