import type { EnhancedNotes } from '../../shared/types';
import type { EnhancerSegment } from './enhancer';

// ─────────────────────────────────────────────────────────────────────────────
// Enhancer prompt — VERSION 1 (2026-05-25).
// Bump PROMPT_VERSION and the date whenever the wording below changes, so prompt
// changes are traceable (CLAUDE.md §8).
// ─────────────────────────────────────────────────────────────────────────────
export const PROMPT_VERSION = 1;

export const SYSTEM_PROMPT = `You enhance a user's rough meeting notes using the meeting transcript. You return the result by calling the emit_enhanced_notes tool.

Rules:
- PRESERVE the user's notes. Never delete, contradict, or silently rewrite the user's points. Expand and structure them. Emit each of the user's own points as a block with origin "user".
- ADD structure and detail drawn from the transcript: headings, key points, decisions, and concrete action items. These added blocks have origin "ai".
- Draw specifics (names, numbers, decisions, quotes) from the transcript for "ai" blocks. Do not invent facts that are not supported by the notes or the transcript.
- For each "ai" block, set sourceSegmentIds to the transcript segment id(s) — the [id=N] markers — it was derived from. Use an empty array for "user" blocks.
- Block types: "heading", "paragraph", "bullet", "action_item". Use "action_item" for concrete tasks/todos.
- Order blocks to read naturally: a heading, then the relevant points beneath it.`;

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
  for (const para of aiMarkdown.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    blocks.push({ type: 'paragraph', text: para, origin: 'ai', sourceSegmentIds: [] });
  }
  if (blocks.length === 0) {
    blocks.push({ type: 'paragraph', text: '', origin: 'ai', sourceSegmentIds: [] });
  }
  return { blocks };
}
