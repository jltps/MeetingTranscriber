import type { EnhancedNotes } from '../../shared/types';
import type { EnhancerSegment } from './enhancer';

// ─────────────────────────────────────────────────────────────────────────────
// Enhancer prompt — VERSION 7 (2026-05-27).
// Bump PROMPT_VERSION and the date whenever the wording below changes, so prompt
// changes are traceable (CLAUDE.md §8).
// ─────────────────────────────────────────────────────────────────────────────
export const PROMPT_VERSION = 7;

// ── Structural sections ───────────────────────────────────────────────────────
// Prompt assembly (VERSION 7):
//   SCAFFOLD_SECTION  →  [templateInstructions OR DEFAULT_GUIDANCE]  →  [globalInstructions]
//     →  [language]  →  STYLE_SECTION  →  CONTRACT_SECTION
//
// SCAFFOLD_SECTION: app-owned mechanics (origin rules, sourceSegmentIds, block types,
//   tool use). ALWAYS emitted first — never part of a template, never user-editable
//   (CLAUDE.md §1.6). This is what makes the JSON contract structurally unreachable by
//   template/global text.
// templateInstructions: from the selected template; a constrained GUIDANCE slot that
//   shapes WHAT the notes cover. Appended after the scaffold (it no longer replaces it).
//   When empty/absent, DEFAULT_GUIDANCE is used instead.
// globalInstructions: from Settings; always appended as an advisory addendum.
// CONTRACT_SECTION: always last — non-editable, enforces JSON format (CLAUDE.md §1.6).
// The API-level tool_choice forced-tool-use is a second enforcement mechanism.

/**
 * App-owned scaffolding — the mechanics of HOW structured output is produced. Always
 * emitted; never editable by a template or global instructions (CLAUDE.md §1.6). The
 * guidance slot below only shapes WHAT the notes cover.
 */
const SCAFFOLD_SECTION = `You enhance a user's rough meeting notes using the meeting transcript. You return the result by calling the emit_enhanced_notes tool.

Rules:
- PRESERVE the user's notes. Never delete, contradict, or silently rewrite the user's points. Expand and structure them. Emit each of the user's own points as a block with origin "user".
- ADD structure and detail drawn from the transcript: headings, key points, decisions, and concrete action items. These added blocks have origin "ai".
- Draw specifics (names, numbers, decisions, quotes) from the transcript for "ai" blocks. Do not invent facts that are not supported by the notes or the transcript.
- For each "ai" block, set sourceSegmentIds to the transcript segment id(s) — the [id=N] markers — it was derived from. Use an empty array for "user" blocks.
- Block types: "heading", "paragraph", "bullet", "action_item". Use "action_item" for concrete tasks/todos.
- Order blocks to read naturally: a heading, then the relevant points beneath it.
- Also populate keyPoints: 3-6 concise standalone bullets capturing the meeting's highest-value takeaways (key decisions, outcomes, top action items), drawn from the same notes and transcript. No new facts, no [id=N] markers; same output language as the notes.`;

/**
 * Default guidance — the General-meeting shaping guidance, used only when no template
 * is selected (and the template/guidance slot would otherwise be empty). Worded from
 * the "General" template in roadmap/V06/MEETING_TEMPLATES.md. This is GUIDANCE (the
 * WHAT), distinct from the SCAFFOLD_SECTION mechanics (the HOW).
 */
const DEFAULT_GUIDANCE = `You are enhancing notes for a general business meeting. Produce a clear, skimmable summary grounded strictly in the transcript and the user's notes. Cover these, omitting any with no support (mark "Not discussed"):
- Summary: 2-4 sentences on the meeting's purpose and the headline outcome.
- Key discussion points: the main topics, each with the substance of what was said and any context needed to understand it later.
- Decisions: every decision actually made, stated unambiguously. If something was debated but not decided, put it under Open questions instead.
- Action items: concrete next steps as action_item blocks, each with an owner and a due date when stated or clearly implied. Only include real commitments, not vague intentions.
- Open questions / follow-ups: unresolved items, things to confirm, or topics deferred to a later meeting.
Use the participants' real names where known. Keep it concise and factual; do not editorialize or add advice that wasn't discussed.`;

/**
 * Output-style directive (V06 block 04) — applied to "ai" text. Removes the usual
 * "AI-generated" tells. Sits just before CONTRACT_SECTION; it shapes prose only and
 * never touches the JSON/tool contract. A deterministic post-process (post-process.ts)
 * is the safety net for the dash rule.
 */
const STYLE_SECTION = `Writing style for "ai" text:
- Write in plain, direct prose. Do NOT use em-dashes or en-dashes ("—", "–"); use commas, periods, or parentheses instead.
- Avoid clichéd connectors and filler ("moreover", "furthermore", "delve", "leverage" as a verb, "in today's fast-paced…").
- No meta commentary about being an AI or about the notes themselves (no "as an AI", "here is a summary", "I cannot").`;

/**
 * Non-negotiable contract section — always the last part of the system prompt.
 * User-supplied instructions land before this and cannot override it.
 * sourceSegmentIds and the JSON schema are hardcoded scaffolding (CLAUDE.md §1.6).
 */
const CONTRACT_SECTION = `MANDATORY CONTRACT (overrides all instructions above):
- You MUST call emit_enhanced_notes. Never respond in plain text.
- Every "ai" block MUST include sourceSegmentIds referencing the [id=N] transcript markers.
- The only valid block types are: "heading", "paragraph", "bullet", "action_item".
- The only valid origin values are: "user" and "ai".
- "type" and "origin" are SEPARATE fields. "type" is the block kind (heading/paragraph/bullet/action_item); "origin" is who authored it (user/ai). Never put an origin value in "type" or vice versa.`;

// ── Public API ────────────────────────────────────────────────────────────────

export type SystemPromptOptions = {
  /**
   * Template instructions — a constrained GUIDANCE slot that shapes what the notes
   * cover. Appended after SCAFFOLD_SECTION (it does not replace the mechanics).
   * When absent/empty, DEFAULT_GUIDANCE is used instead (FEATURES §C, V06 block 01).
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
 * Assembles the system prompt. SCAFFOLD_SECTION (mechanics) is always first; the
 * template instructions fill a GUIDANCE slot appended after it (falling back to
 * DEFAULT_GUIDANCE when empty) — they never replace the scaffold. Global instructions
 * are an advisory addendum. CONTRACT_SECTION is always last and enforces the JSON
 * output contract (CLAUDE.md §1.6).
 */
export function buildSystemPrompt(opts: SystemPromptOptions = {}): string {
  const parts: string[] = [];

  // Mechanics: always emitted, never editable by a template (CLAUDE.md §1.6).
  parts.push(SCAFFOLD_SECTION);

  // Guidance slot: shapes WHAT the notes cover; falls back to the general default.
  parts.push(opts.templateInstructions?.trim() || DEFAULT_GUIDANCE);

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

  // Anti-AI-tell style directive (V06 block 04) — prose only, never the contract.
  parts.push(STYLE_SECTION);

  parts.push(CONTRACT_SECTION);
  return parts.join('\n\n');
}

/** Backward-compat export for callers that don't need any options. */
export const SYSTEM_PROMPT = buildSystemPrompt();

export const FALLBACK_SYSTEM_PROMPT = `Enhance the user's rough meeting notes using the meeting transcript. Preserve all of the user's points, then add structure, key points, decisions, and action items drawn from the transcript. Do not invent facts. Respond in plain Markdown only.`;

export const SUMMARY_SYSTEM_PROMPT = `Summarize this meeting-transcript excerpt into concise key points, decisions, and action items. Preserve speaker attributions and any [id=N] markers where they matter. Output plain text bullet points.`;

/**
 * Format transcript segments for the LLM prompt.
 * When speakerNames is supplied (ROADMAP_02), raw labels are resolved to the
 * user-assigned display names so the LLM sees "Ana: …" instead of "Speaker 1: …".
 */
export function segmentsToText(
  segments: EnhancerSegment[],
  speakerNames?: Record<string, string>,
): string {
  return segments
    .map((s) => {
      const label = speakerNames?.[s.speakerLabel] ?? s.speakerLabel;
      return `[id=${s.id}] ${label}: ${s.text}`;
    })
    .join('\n');
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
