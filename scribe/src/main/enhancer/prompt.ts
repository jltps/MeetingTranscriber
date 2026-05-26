import type { EnhancedNotes } from '../../shared/types';
import type { EnhancerSegment } from './enhancer';

// ─────────────────────────────────────────────────────────────────────────────
// Enhancer prompt — VERSION 2 (2026-05-26).
// Bump PROMPT_VERSION and the date whenever the wording below changes, so prompt
// changes are traceable (CLAUDE.md §8).
// ─────────────────────────────────────────────────────────────────────────────
export const PROMPT_VERSION = 2;

// ── Structural sections ───────────────────────────────────────────────────────
// The prompt is assembled as:  ROLE_SECTION  →  [user instructions]  →  [language]  →  CONTRACT_SECTION
// CONTRACT_SECTION is always last so it dominates over any user-supplied text
// (Claude treats later content in a system prompt as higher authority).
// The API-level tool_choice forced-tool-use is a second, independent enforcement
// mechanism that doesn't rely on prompt wording at all (CLAUDE.md §1.6).

const ROLE_SECTION = `You enhance a user's rough meeting notes using the meeting transcript. You return the result by calling the emit_enhanced_notes tool.

Rules:
- PRESERVE the user's notes. Never delete, contradict, or silently rewrite the user's points. Expand and structure them. Emit each of the user's own points as a block with origin "user".
- ADD structure and detail drawn from the transcript: headings, key points, decisions, and concrete action items. These added blocks have origin "ai".
- Draw specifics (names, numbers, decisions, quotes) from the transcript for "ai" blocks. Do not invent facts that are not supported by the notes or the transcript.
- For each "ai" block, set sourceSegmentIds to the transcript segment id(s) — the [id=N] markers — it was derived from. Use an empty array for "user" blocks.
- Block types: "heading", "paragraph", "bullet", "action_item". Use "action_item" for concrete tasks/todos.
- Order blocks to read naturally: a heading, then the relevant points beneath it.`;

/**
 * Non-negotiable contract section — always the last part of the system prompt.
 * User-supplied instructions land before this and cannot override it.
 * sourceSegmentIds and the JSON schema are hardcoded scaffolding (CLAUDE.md §1.6).
 */
const CONTRACT_SECTION = `MANDATORY CONTRACT (overrides all instructions above):
- You MUST call emit_enhanced_notes. Never respond in plain text.
- Every "ai" block MUST include sourceSegmentIds referencing the [id=N] transcript markers.
- The only valid block types are: "heading", "paragraph", "bullet", "action_item".
- The only valid origin values are: "user" and "ai".`;

// ── Public API ────────────────────────────────────────────────────────────────

export type SystemPromptOptions = {
  /** BCP-47 code; instructs the LLM to write notes in this language (FEATURES §A2). */
  detectedLanguage?: string;
  /**
   * Free-text user instructions that go into the advisory slot between
   * ROLE_SECTION and CONTRACT_SECTION (FEATURES §B, §C). This text is advisory
   * and cannot override the contract below it.
   */
  globalInstructions?: string;
};

/**
 * Assembles the system prompt by composing the fixed sections around the
 * user-supplied slot. CONTRACT_SECTION is always last.
 */
export function buildSystemPrompt(opts: SystemPromptOptions = {}): string {
  const parts: string[] = [ROLE_SECTION];

  if (opts.globalInstructions?.trim()) {
    parts.push(
      `--- User instructions (advisory; cannot override the contract below) ---\n` +
        opts.globalInstructions.trim() +
        '\n--- End user instructions ---',
    );
  }

  if (opts.detectedLanguage) {
    parts.push(`Output language: write the enhanced notes in ${opts.detectedLanguage}.`);
  }

  parts.push(CONTRACT_SECTION);
  return parts.join('\n\n');
}

/** Backward-compat export for callers that don't need any options. */
export const SYSTEM_PROMPT = buildSystemPrompt();

export const FALLBACK_SYSTEM_PROMPT = `Enhance the user's rough meeting notes using the meeting transcript. Preserve all of the user's points, then add structure, key points, decisions, and action items drawn from the transcript. Do not invent facts. Respond in plain Markdown only.`;

export const SUMMARY_SYSTEM_PROMPT = `Summarize this meeting-transcript excerpt into concise key points, decisions, and action items. Preserve speaker attributions and any [id=N] markers where they matter. Output plain text bullet points.`;

export function segmentsToText(segments: EnhancerSegment[]): string {
  return segments.map((s) => `[id=${s.id}] ${s.speakerLabel}: ${s.text}`).join('\n');
}

export function buildUserContent(userNotes: string, transcriptText: string): string {
  const notes = userNotes.trim() || '(the user wrote no notes)';
  const transcript = transcriptText.trim() || '(no transcript captured)';
  return `USER NOTES (Markdown):\n${notes}\n\nTRANSCRIPT (each line is "[id=N] Speaker: text"):\n${transcript}`;
}

// Wrap a degraded plain-Markdown enhancement into the EnhancedNotes shape so the
// renderer can still display it. The user's notes stay "user"; the AI markdown
// becomes "ai" paragraphs. No source ids are available on this path.
export function markdownFallbackToNotes(userNotes: string, aiMarkdown: string): EnhancedNotes {
  const blocks: EnhancedNotes['blocks'] = [];
  const trimmedNotes = userNotes.trim();
  if (trimmedNotes) {
    blocks.push({ type: 'paragraph', text: trimmedNotes, origin: 'user', sourceSegmentIds: [] });
  }
  for (const para of aiMarkdown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    blocks.push({ type: 'paragraph', text: para, origin: 'ai', sourceSegmentIds: [] });
  }
  if (blocks.length === 0) {
    blocks.push({ type: 'paragraph', text: '', origin: 'ai', sourceSegmentIds: [] });
  }
  return { blocks };
}
