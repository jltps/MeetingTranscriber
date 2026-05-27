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
} as const;

/**
 * Estimate the total USD cost for a meeting.
 * `deepgramAudioMs` is the total captured audio duration in milliseconds.
 * Deepgram is billed per channel, so cost scales with `deepgramChannels`. Defaults
 * to 2 (the pre-V05 stereo capture); V05+ mono meetings pass 1 (V05 ROADMAP_02).
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
