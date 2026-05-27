/**
 * Unit tests for the keyboard-shortcut matcher (ROADMAP_V04_05). Pure function —
 * no DOM needed; KeyboardEvent fields are passed as a plain object.
 */
import { describe, it, expect } from 'vitest';
import { matchShortcut, type KeyChord, type Shortcut } from '../src/renderer/features/commands/actions';

const ev = (p: Partial<KeyChord>): KeyChord => ({
  key: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...p,
});

const modN: Shortcut = { mod: true, key: 'n', display: 'Ctrl+N' };
const modShiftA: Shortcut = { mod: true, shift: true, key: 'a', display: 'Ctrl+Shift+A' };
const slash: Shortcut = { key: '/', display: '/' };

describe('matchShortcut', () => {
  it('matches a mod chord with either Ctrl or Cmd', () => {
    expect(matchShortcut(ev({ ctrlKey: true, key: 'n' }), modN)).toBe(true);
    expect(matchShortcut(ev({ metaKey: true, key: 'n' }), modN)).toBe(true);
  });

  it('requires the modifier for mod chords', () => {
    expect(matchShortcut(ev({ key: 'n' }), modN)).toBe(false);
  });

  it('respects the shift requirement (both directions) and is case-insensitive', () => {
    expect(matchShortcut(ev({ ctrlKey: true, shiftKey: true, key: 'A' }), modShiftA)).toBe(true);
    expect(matchShortcut(ev({ ctrlKey: true, key: 'a' }), modShiftA)).toBe(false); // missing shift
    expect(matchShortcut(ev({ ctrlKey: true, shiftKey: true, key: 'n' }), modN)).toBe(false); // extra shift
  });

  it('matches a bare key only without modifiers', () => {
    expect(matchShortcut(ev({ key: '/' }), slash)).toBe(true);
    expect(matchShortcut(ev({ ctrlKey: true, key: '/' }), slash)).toBe(false);
  });

  it('rejects when Alt is held', () => {
    expect(matchShortcut(ev({ ctrlKey: true, altKey: true, key: 'n' }), modN)).toBe(false);
  });
});
