/**
 * Pricing constants and helpers for cost estimates (ROADMAP_01 §3, §Key decisions).
 * Lives in shared/ so both the main process and the renderer can import it.
 * These are approximations — label them as such in the UI.
 * Update rates here whenever Deepgram or Anthropic publishes new pricing.
 *
 * This module imports nothing from electron, node:*, or React (CLAUDE.md §3).
 */
export const PRICING = {
  /**
   * Deepgram Nova-3 streaming — per channel per minute (USD). As of May 2026 list
   * pricing this is ≈ the multilingual rate ($0.0058); a fixed monolingual language
   * is cheaper (~$0.0048). Deepgram bills *per channel*, and the app currently captures
   * 2 channels, so the effective per-minute cost is ~2× this value — see the `* 2` in
   * estimateCost(). V05 ROADMAP_02 drops to a single channel to halve it.
   */
  deepgramNovaPerMinutePerChannel: 0.0059,
  /** Claude Sonnet — per 1 million input tokens (USD). */
  claudeSonnetInputPer1MTokens: 3.0,
  /** Claude Sonnet — per 1 million output tokens (USD). */
  claudeSonnetOutputPer1MTokens: 15.0,
  /** Claude Haiku 4.5 — per 1 million input tokens (USD). Used for title/summarize/optimize and Economy enhance/chat (V06 block 04). */
  claudeHaikuInputPer1MTokens: 1.0,
  /** Claude Haiku 4.5 — per 1 million output tokens (USD). */
  claudeHaikuOutputPer1MTokens: 5.0,
} as const;

/** Which Claude tier a set of tokens was billed at. */
export type ClaudeTier = 'sonnet' | 'haiku';

/** USD cost of Claude tokens at a given tier (V06 block 04). */
export function claudeTokenCost(
  inputTokens: number,
  outputTokens: number,
  tier: ClaudeTier,
): number {
  const input = tier === 'haiku' ? PRICING.claudeHaikuInputPer1MTokens : PRICING.claudeSonnetInputPer1MTokens;
  const output = tier === 'haiku' ? PRICING.claudeHaikuOutputPer1MTokens : PRICING.claudeSonnetOutputPer1MTokens;
  return (inputTokens / 1_000_000) * input + (outputTokens / 1_000_000) * output;
}

/**
 * Estimate the total USD cost for a meeting.
 * `deepgramAudioMs` is the total captured audio duration in milliseconds.
 * Deepgram is billed per channel, so cost scales with `deepgramChannels`. Defaults
 * to 2 (the pre-V05 stereo capture); V05+ mono meetings pass 1 (V05 ROADMAP_02).
 *
 * Claude tokens are priced at the Sonnet rate (the dominant enhancement cost). Since
 * V06 block 04 runs long-transcript chunk-summarization on the cheaper Haiku model,
 * this is a slight, conservative over-estimate for very long meetings — acceptable for
 * the usage readout. (Title tokens aren't tracked here at all.)
 */
export function estimateCost(
  deepgramAudioMs: number,
  claudeInputTokens: number,
  claudeOutputTokens: number,
  deepgramChannels = 2,
): number {
  const deepgramMinutes = deepgramAudioMs / 1000 / 60;
  const deepgramCost = deepgramMinutes * deepgramChannels * PRICING.deepgramNovaPerMinutePerChannel;

  const claudeCost =
    (claudeInputTokens / 1_000_000) * PRICING.claudeSonnetInputPer1MTokens +
    (claudeOutputTokens / 1_000_000) * PRICING.claudeSonnetOutputPer1MTokens;

  return deepgramCost + claudeCost;
}

/** Format a cost estimate as a human-readable string like "$0.04" or "< $0.01". */
export function formatCost(usd: number): string {
  if (usd < 0.005) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}

/** Format audio duration in milliseconds as "Xm Ys" or "Xs". */
export function formatAudioDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
