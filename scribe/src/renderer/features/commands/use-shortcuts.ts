import { useEffect } from 'react';
import { matchShortcut, type Action } from './actions';

// True when focus is in an editable element — bare-key shortcuts must not fire then
// (covers <input>/<textarea>/<select> and the TipTap contenteditable).
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// Global keyboard shortcuts (ROADMAP_V04_05). Renderer-only (not Electron
// globalShortcut). Ctrl/Cmd-K always toggles the palette; other chords run the first
// matching enabled action — bare-key chords only when not typing. Clipboard/format
// keys are never bound, so Chromium + TipTap keep handling them.
export function useShortcuts(actions: Action[], onTogglePalette: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onTogglePalette();
        return;
      }
      const typing = isTyping();
      for (const a of actions) {
        if (!a.shortcut || !a.enabled) continue;
        if (!a.shortcut.mod && typing) continue; // bare-key shortcut while typing
        if (matchShortcut(e, a.shortcut)) {
          e.preventDefault();
          a.run();
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions, onTogglePalette]);
}
