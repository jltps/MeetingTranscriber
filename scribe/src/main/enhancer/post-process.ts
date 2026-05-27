// Deterministic anti-AI-tell pass (V06 block 04). The prompt's STYLE_SECTION is the
// primary mechanism; this is the safety net for the dash rule, applied to enhancer
// output. It rewrites em/en dashes ONLY in AI-derived text — "ai"-origin blocks and the
// keyPoints summary (V06 block 03). The user's own notes ("user" blocks) are never
// altered (CLAUDE.md §1.5).
import type { EnhancedNotes } from '../../shared/types';

/**
 * Replace the em-dash and (non-numeric) en-dash with a comma, the most common
 * AI-tell punctuation. Conservative: an en-dash between digits ("3–5", "2020–2024")
 * is left intact so number ranges aren't mangled. Collapses any resulting " ," to ",".
 */
export function stripDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, ', ') // em-dash → comma
    .replace(/(?<!\d)\s*–\s*(?!\d)/g, ', ') // en-dash → comma, except numeric ranges
    .replace(/ ,/g, ',');
}

/**
 * Apply the style cleanup to AI-derived text: every "ai" block's text and the keyPoints
 * summary. "user" blocks are left untouched (§1.5).
 */
export function stripAiTells(notes: EnhancedNotes): EnhancedNotes {
  return {
    ...notes,
    blocks: notes.blocks.map((b) =>
      b.origin === 'ai' ? { ...b, text: stripDashes(b.text) } : b,
    ),
    ...(notes.keyPoints ? { keyPoints: notes.keyPoints.map(stripDashes) } : {}),
  };
}
