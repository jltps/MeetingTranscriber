import { AnthropicEnhancer } from './anthropic';
import { getAnthropicKey } from '../secrets/api-keys';
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
  try {
    return { notes: await enhancer.enhance(input), degraded: false };
  } catch {
    return { notes: await enhancer.enhanceFallback(input), degraded: true };
  }
}
