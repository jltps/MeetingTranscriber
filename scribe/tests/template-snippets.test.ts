import { describe, it, expect } from 'vitest';
import { insertSnippet } from '../src/renderer/features/templates/template-snippets';

describe('insertSnippet (template editor authoring aid, V06 block 02)', () => {
  it('appends on a new line when inserting at the end of non-empty text', () => {
    const value = 'First line';
    const { value: next, cursor } = insertSnippet(value, value.length, value.length, 'Snippet');
    expect(next).toBe('First line\nSnippet');
    // Caret sits at the end of the inserted snippet text.
    expect(next.slice(0, cursor)).toBe('First line\nSnippet');
  });

  it('does not add a leading newline when the text is empty', () => {
    const { value, cursor } = insertSnippet('', 0, 0, 'Snippet');
    expect(value).toBe('Snippet');
    expect(cursor).toBe('Snippet'.length);
  });

  it('inserts at a mid-text cursor, padding with newlines on both sides', () => {
    const value = 'A\nB';
    // Caret between "A\n" and "B" (position 2).
    const { value: next, cursor } = insertSnippet(value, 2, 2, 'X');
    expect(next).toBe('A\nX\nB');
    expect(next.slice(0, cursor)).toBe('A\nX');
  });

  it('replaces the selected range', () => {
    const value = 'keep REPLACE keep';
    const start = value.indexOf('REPLACE');
    const end = start + 'REPLACE'.length;
    const { value: next } = insertSnippet(value, start, end, 'NEW');
    expect(next).toBe('keep \nNEW\n keep');
  });

  it('does not double a newline that already precedes the cursor', () => {
    const value = 'Intro\n';
    const { value: next } = insertSnippet(value, value.length, value.length, 'Snippet');
    expect(next).toBe('Intro\nSnippet');
  });
});
