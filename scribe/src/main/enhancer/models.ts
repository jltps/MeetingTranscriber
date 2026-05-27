// Central task → model resolver (V06 block 04). The one place that decides which
// Anthropic model each kind of call uses, so cost/quality routing lives in a single,
// unit-testable function instead of scattered constants. Callers in main resolve the
// model from the user's quality mode (db/settings getQualityMode) and pass it down;
// this module stays pure (no db, no electron) so it can be tested directly.
import type { QualityMode } from '../../shared/ipc-contract';

// Model ids per CLAUDE.md §2/§8.
export const SONNET = 'claude-sonnet-4-6';
export const HAIKU = 'claude-haiku-4-5-20251001';

/** The kinds of LLM calls the app makes. */
export type LlmTask = 'enhance' | 'title' | 'summarize' | 'chat' | 'optimize';

/**
 * Resolve the model id for a task under the current quality mode.
 * - enhance / chat: the strong model on Quality, the cheap model on Economy.
 * - title / summarize / optimize: always the cheap model (simple, high-volume work).
 */
export function resolveModel(task: LlmTask, mode: QualityMode): string {
  switch (task) {
    case 'enhance':
    case 'chat':
      return mode === 'economy' ? HAIKU : SONNET;
    case 'title':
    case 'summarize':
    case 'optimize':
      return HAIKU;
  }
}
