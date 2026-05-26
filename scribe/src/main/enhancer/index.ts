import { AnthropicEnhancer } from './anthropic';
import { getAnthropicKey } from '../secrets/api-keys';
import { getGlobalInstructions } from '../db/settings';
import type { EnhanceInput } from './enhancer';
import type { EnhanceResult } from '../../shared/ipc-contract';

// Orchestrates enhancement behind the Enhancer interface (CLAUDE.md §8). On
// strict-JSON failure (after the in-method retry) it falls back to a plain
// Markdown enhancement and marks the result degraded for the UI.
export async function runEnhancement(input: EnhanceInput): Promise<EnhanceResult> {
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
    return { notes: await enhancer.enhance(fullInput), degraded: false };
  } catch {
    return { notes: await enhancer.enhanceFallback(fullInput), degraded: true };
  }
}
