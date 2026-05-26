import { AnthropicEnhancer } from './anthropic';
import { getAnthropicKey } from '../secrets/api-keys';
import { getGlobalInstructions } from '../db/settings';
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
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    throw new Error('Anthropic API key not set. Set ANTHROPIC_API_KEY (env or .env) before enhancing.');
  }
  const enhancer = new AnthropicEnhancer(apiKey);
  // Merge global instructions unless the caller already provided (template) instructions.
  const fullInput: EnhanceInput = {
    ...input,
    // templateInstructions passed through as-is (ipc/enhancer.ts resolved it).
    globalInstructions: input.globalInstructions ?? (getGlobalInstructions() || undefined),
  };
  try {
    const result = await enhancer.enhance(fullInput);
    return { notes: result.notes, degraded: false, usage: result.usage };
  } catch {
    const result = await enhancer.enhanceFallback(fullInput);
    return { notes: result.notes, degraded: true, usage: result.usage };
  }
}
