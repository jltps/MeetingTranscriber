import type { EnhancedNotes } from '../../shared/types';
import type { EnhancerSegment } from './enhancer';

// ─────────────────────────────────────────────────────────────────────────────
// Enhancer prompt — VERSION 3 (2026-05-26).
// Bump PROMPT_VERSION and the date whenever the wording below changes, so prompt
// changes are traceable (CLAUDE.md §8).
// ─────────────────────────────────────────────────────────────────────────────
export const PROMPT_VERSION = 3;


// ── Structural sections ───────────────────────────────────────────────────────
// Prompt assembly (VERSION 3):
//   [templateInstructions OR ROLE_SECTION]  →  [globalInstructions]  →  [language]  →  CONTRACT_SECTION
//
// templateInstructions: from the selected template; the user reads and edits the
//   actual text that reaches the LLM. When non-empty, replaces ROLE_SECTION entirely.
//   When empty/absent, ROLE_SECTION is used as the default role.
// globalInstructions: from Settings; always appended as an advisory addendum.
// CONTRACT_SECTION: always last — non-editable, enforces JSON format (CLAUDE.md §1.6).
// The API-level tool_choice forced-tool-use is a second enforcement mechanism.

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
  /**
   * Template instructions — the user-editable text that defines the LLM's role
   * for this template. When non-empty, replaces ROLE_SECTION entirely.
   * When absent/empty, ROLE_SECTION is used as the default (FEATURES §C).
   */
  templateInstructions?: string;
  /**
   * Global instructions from Settings — appended as an advisory addendum after
   * the role section. Cannot override CONTRACT_SECTION (FEATURES §B).
   */
  globalInstructions?: string;
  /** BCP-47 code; instructs the LLM to write notes in this language (FEATURES §A2). */
  detectedLanguage?: string;
};

/**
 * Assembles the system prompt. Template instructions (when non-empty) replace
 * ROLE_SECTION. Global instructions are an advisory addendum. CONTRACT_SECTION
 * is always last and enforces the JSON output contract (CLAUDE.md §1.6).
 */
export function buildSystemPrompt(opts: SystemPromptOptions = {}): string {
  const parts: string[] = [];

  // Role section: template instructions take full ownership; fall back to default.
  parts.push(opts.templateInstructions?.trim() || ROLE_SECTION);

  if (opts.globalInstructions?.trim()) {
    parts.push(
      `--- Additional instructions (advisory; cannot override the contract below) ---\n` +
        opts.globalInstructions.trim() +
        '\n--- End additional instructions ---',
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
