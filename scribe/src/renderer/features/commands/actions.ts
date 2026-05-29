import {
  Download,
  FileText,
  MessageSquare,
  Mic,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  SunMoon,
} from 'lucide-react';
import type { ComponentType } from 'react';

// Single source of truth for app actions (ROADMAP_V04_05) — consumed by both the
// command palette and the keyboard-shortcut hook. Actions depend on live App state,
// so the registry is a factory over a context the App supplies.

export type Shortcut = { mod?: boolean; shift?: boolean; key: string; display: string };

export type Action = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  shortcut?: Shortcut;
  enabled: boolean;
  run: () => void;
};

export type ActionContext = {
  onNewNote: () => void;
  openSettings: () => void;
  openCrossChat: () => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  focusSearch: () => void;
  exportMeeting: () => void;
  enhanceMeeting: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  setView: (v: 'original' | 'enhanced') => void;
  setNoteSurface: (s: 'notes' | 'chat') => void;
  hasMeeting: boolean;
  running: boolean;
  hasEnhanced: boolean;
  view: 'original' | 'enhanced';
  noteSurface: 'notes' | 'chat';
};

// Accessed via globalThis so this module needs no DOM lib (it's also pulled into the
// node tsconfig by the unit test).
const nav = (globalThis as { navigator?: { platform?: string } }).navigator;
const isMac = !!nav?.platform && nav.platform.toLowerCase().includes('mac');

/**
 * Minimal keyboard-event shape — the DOM KeyboardEvent satisfies it structurally.
 * Keeps matchShortcut free of the DOM lib so it can be unit-tested under node.
 */
export type KeyChord = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

/** Build a shortcut with a platform-appropriate display string. */
function sc(opts: { mod?: boolean; shift?: boolean; key: string; label?: string }): Shortcut {
  const parts: string[] = [];
  if (opts.mod) parts.push(isMac ? '⌘' : 'Ctrl');
  if (opts.shift) parts.push(isMac ? '⇧' : 'Shift');
  parts.push(opts.label ?? opts.key.toUpperCase());
  return { mod: opts.mod, shift: opts.shift, key: opts.key, display: parts.join(isMac ? '' : '+') };
}

/** True when a keydown event matches the shortcut chord. */
export function matchShortcut(e: KeyChord, s: Shortcut): boolean {
  const mod = Boolean(e.metaKey) || Boolean(e.ctrlKey);
  if (Boolean(s.mod) !== mod) return false;
  if (Boolean(s.shift) !== Boolean(e.shiftKey)) return false;
  if (e.altKey) return false;
  return e.key.toLowerCase() === s.key.toLowerCase();
}

export function buildActions(ctx: ActionContext): Action[] {
  const inMeeting = ctx.hasMeeting;
  return [
    {
      id: 'new-note',
      label: 'New note',
      icon: Plus,
      shortcut: sc({ mod: true, key: 'n' }),
      enabled: true,
      run: ctx.onNewNote,
    },
    {
      id: 'ask-across',
      label: 'Ask across meetings',
      icon: MessageSquare,
      shortcut: sc({ mod: true, shift: true, key: 'a' }),
      enabled: true,
      run: ctx.openCrossChat,
    },
    {
      id: 'toggle-theme',
      label: 'Toggle theme',
      icon: SunMoon,
      shortcut: sc({ mod: true, shift: true, key: 'l' }),
      enabled: true,
      run: ctx.toggleTheme,
    },
    {
      id: 'open-settings',
      label: 'Open settings',
      icon: Settings,
      shortcut: sc({ mod: true, key: ',', label: ',' }),
      enabled: true,
      run: ctx.openSettings,
    },
    {
      id: 'focus-search',
      label: 'Search notes',
      icon: Search,
      shortcut: sc({ key: '/', label: '/' }),
      enabled: true,
      run: ctx.focusSearch,
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle sidebar',
      icon: PanelLeft,
      shortcut: sc({ mod: true, key: '\\', label: '\\' }),
      enabled: true,
      run: ctx.toggleSidebar,
    },
    {
      id: 'enhance',
      label: 'Enhance notes',
      icon: Sparkles,
      enabled: inMeeting && !ctx.running,
      run: ctx.enhanceMeeting,
    },
    {
      id: 'export',
      label: 'Export note to Markdown',
      icon: Download,
      enabled: inMeeting && !ctx.running,
      run: ctx.exportMeeting,
    },
    {
      id: 'toggle-view',
      label: ctx.view === 'enhanced' ? 'Show original notes' : 'Show enhanced notes',
      icon: FileText,
      enabled: inMeeting && ctx.hasEnhanced,
      run: () => ctx.setView(ctx.view === 'enhanced' ? 'original' : 'enhanced'),
    },
    {
      id: 'toggle-chat',
      label: ctx.noteSurface === 'chat' ? 'Back to notes' : 'Open chat',
      icon: MessageSquare,
      enabled: inMeeting,
      run: () => ctx.setNoteSurface(ctx.noteSurface === 'chat' ? 'notes' : 'chat'),
    },
    {
      id: 'start-recording',
      label: 'Start recording',
      icon: Mic,
      enabled: inMeeting && !ctx.running,
      run: ctx.startRecording,
    },
    {
      id: 'stop-recording',
      label: 'Stop recording',
      icon: Square,
      enabled: inMeeting && ctx.running,
      run: ctx.stopRecording,
    },
  ];
}
