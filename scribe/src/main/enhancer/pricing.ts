// Re-export from shared so existing main-process imports continue to work.
// The canonical source of truth is src/shared/pricing.ts (CLAUDE.md §3).
export { PRICING, estimateCost, formatCost, formatAudioDuration } from '../../shared/pricing';
