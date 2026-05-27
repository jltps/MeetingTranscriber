// Authoring aids for the template editor (V06 block 02). Everything here is
// GUIDANCE-only text — it shapes WHAT the notes cover. The HOW (tool use, JSON,
// sourceSegmentIds, block types) is app-owned scaffolding added at enhance time by
// buildSystemPrompt (block 01), so none of it appears here. Wording is aligned with
// roadmap/V06/MEETING_TEMPLATES.md and the General DEFAULT_GUIDANCE in
// main/enhancer/prompt.ts.

/**
 * Editable starter prefilled into a NEW template's instructions, modelling the house
 * style (sectioned guidance, the "Not discussed" honesty rule, owner + due-date action
 * items). Users refine, replace, or clear it.
 */
export const STARTER_INSTRUCTIONS = `You are enhancing notes for a general business meeting. Produce a clear, skimmable summary grounded strictly in the transcript and the user's notes. Cover these, omitting any with no support (mark "Not discussed"):
- Summary: 2-4 sentences on the meeting's purpose and the headline outcome.
- Key discussion points: the main topics, each with the substance of what was said and the context needed to understand it later.
- Decisions: every decision actually made, stated unambiguously. If something was debated but not decided, list it under Open questions instead.
- Action items: concrete next steps, each with an owner and a due date when stated or clearly implied. Only real commitments, not vague intentions.
- Open questions / follow-ups: unresolved items, things to confirm, or topics deferred to a later meeting.
Use the participants' real names where known. Keep it concise and factual; do not editorialize or add advice that wasn't discussed.`;

/** A guidance snippet the user can drop into the instructions at the cursor. */
export type TemplateSnippet = { label: string; text: string };

/** Canned guidance snippets, ordered as they read in a typical template. */
export const TEMPLATE_SNIPPETS: readonly TemplateSnippet[] = [
  {
    label: 'Summary',
    text: 'Summary: 2-4 sentences on the meeting’s purpose and the headline outcome.',
  },
  {
    label: 'Key points',
    text: 'Key discussion points: the main topics, each with the substance of what was said and the context needed to understand it later.',
  },
  {
    label: 'Decisions',
    text: 'Decisions: every decision actually made, stated unambiguously. If something was debated but not decided, list it under Open questions instead.',
  },
  {
    label: 'Action items',
    text: 'Action items: concrete next steps, each with an owner and a due date when stated or clearly implied. Only real commitments, not vague intentions.',
  },
  {
    label: 'Open questions',
    text: 'Open questions / follow-ups: unresolved items, things to confirm, or topics deferred to a later meeting.',
  },
  {
    label: 'Checklist',
    text: 'Checklist: present the relevant items as a checkable to-do list the reader can tick off.',
  },
];

/**
 * Insert `snippet` into `value` at the selection [selStart, selEnd), replacing any
 * selected text. The snippet is padded with newlines so it lands on its own line, and
 * the returned `cursor` sits at the end of the inserted snippet (before any trailing
 * newline) so the user can keep typing on that line. Pure — unit-tested.
 */
export function insertSnippet(
  value: string,
  selStart: number,
  selEnd: number,
  snippet: string,
): { value: string; cursor: number } {
  const before = value.slice(0, selStart);
  const after = value.slice(selEnd);
  const lead = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const trail = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
  const newValue = before + lead + snippet + trail + after;
  const cursor = before.length + lead.length + snippet.length;
  return { value: newValue, cursor };
}
