import { describe, it, expect } from 'vitest';
import { HAIKU, SONNET, resolveModel, type LlmTask } from '../src/main/enhancer/models';

describe('resolveModel (V06 block 04 task → model)', () => {
  it('uses Sonnet for enhance/chat in Quality mode', () => {
    expect(resolveModel('enhance', 'quality')).toBe(SONNET);
    expect(resolveModel('chat', 'quality')).toBe(SONNET);
  });

  it('drops enhance/chat to Haiku in Economy mode', () => {
    expect(resolveModel('enhance', 'economy')).toBe(HAIKU);
    expect(resolveModel('chat', 'economy')).toBe(HAIKU);
  });

  it('always uses Haiku for the cheap tasks regardless of mode', () => {
    for (const task of ['title', 'summarize', 'optimize'] as const) {
      expect(resolveModel(task, 'quality')).toBe(HAIKU);
      expect(resolveModel(task, 'economy')).toBe(HAIKU);
    }
  });

  it('returns a non-empty id for every task in both modes', () => {
    const tasks: LlmTask[] = ['enhance', 'title', 'summarize', 'chat', 'optimize'];
    for (const task of tasks) {
      for (const mode of ['quality', 'economy'] as const) {
        expect(resolveModel(task, mode).length).toBeGreaterThan(0);
      }
    }
  });
});
