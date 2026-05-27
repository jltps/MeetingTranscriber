import { activeEnhancer } from '../llm/provider';
import { stripAiTells } from './post-process';
import { getGlobalInstructions } from '../db/settings';
import { logger } from '../logger';
import type { EnhanceInput, EnhancerUsage } from './enhancer';
import type { EnhancedNotes } from '../../shared/types';

/** Full result from runEnhancement, including token usage for cost tracking. */
export type RunEnhancementResult = {
  notes: EnhancedNotes;
  degraded: boolean;
  usage: EnhancerUsage;
};

// Orchestrates enhancement behind the Enhancer interface (CLAUDE.md §8). On
// strict-JSON failure (after the in-method retry) it falls back to a plain
// Markdown enhancement and marks the result degraded for the UI.
export async function runEnhancement(input: EnhanceInput): Promise<RunEnhancementResult> {
  // The factory picks Anthropic or the OpenAI-compatible provider and throws a clear
  // error if the active provider isn't configured (key/base URL/model) — V06 block 05.
  const enhancer = activeEnhancer();
  // Merge global instructions unless the caller already provided (template) instructions.
  const fullInput: EnhanceInput = {
    ...input,
    // templateInstructions passed through as-is (ipc/enhancer.ts resolved it).
    globalInstructions: input.globalInstructions ?? (getGlobalInstructions() || undefined),
  };
  try {
    const result = await enhancer.enhance(fullInput);
    // Strip AI tells (em-dashes etc.) from ai-origin text only (V06 block 04, §1.5).
    return { notes: stripAiTells(result.notes), degraded: false, usage: result.usage };
  } catch (err) {
    // Record *why* structured enhancement failed before degrading — otherwise the
    // UI's "degraded" banner is the only signal and the cause stays invisible.
    logger.warn(
      'enhancement: structured output failed, using plain-text fallback',
      err instanceof Error ? err : String(err),
    );
    const result = await enhancer.enhanceFallback(fullInput);
    return { notes: stripAiTells(result.notes), degraded: true, usage: result.usage };
  }
}
