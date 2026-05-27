import { describe, it, expect } from 'vitest';
import { cleanTitle } from '../src/main/enhancer/title-format';

describe('cleanTitle (V06 block 04 — concise titles)', () => {
  it('strips wrapping quotes', () => {
    expect(cleanTitle('"Q3 Planning Sync"')).toBe('Q3 Planning Sync');
    expect(cleanTitle('“Budget Review”')).toBe('Budget Review');
  });

  it('removes trailing punctuation and dashes', () => {
    expect(cleanTitle('Sales pipeline review.')).toBe('Sales pipeline review');
    expect(cleanTitle('Roadmap planning —')).toBe('Roadmap planning');
    expect(cleanTitle('Standup:')).toBe('Standup');
  });

  it('collapses whitespace and trims', () => {
    expect(cleanTitle('  Weekly   team   sync  ')).toBe('Weekly team sync');
  });

  it('leaves a clean title unchanged', () => {
    expect(cleanTitle('Onboarding kickoff')).toBe('Onboarding kickoff');
  });
});
