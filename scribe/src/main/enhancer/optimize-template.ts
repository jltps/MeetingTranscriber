// "Optimize with AI" for the template editor (V06 block 02). Takes the user's rough,
// natural-language template instructions and rewrites them into a clean, sectioned
// GUIDANCE block in the house style (roadmap/V06/MEETING_TEMPLATES.md).
//
// The output is GUIDANCE only: it must never describe the mechanics (tool use, JSON,
// sourceSegmentIds, block types, output format) — those are app-owned scaffolding added
// at enhance time by buildSystemPrompt (block 01). Runs in the main process via the
// active LLM provider so the key never reaches the renderer (CLAUDE.md §1.2, V06 block 05).
import { completeText } from '../llm/provider';
import type { OptimizeTemplateInput, OptimizeTemplateResult } from '../../shared/ipc-contract';

const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You help a user author a reusable template for an AI meeting-notes assistant. Rewrite the user's rough notes into clear, well-structured GUIDANCE that tells the assistant what the enhanced notes for this meeting type should contain and emphasize.

Rules:
- Output ONLY the guidance text. No preamble, no explanation, no quotes around it, no closing remarks.
- Write it as a short intro line naming the meeting type, then a bulleted list of the sections/outcomes the notes should cover, in a sensible reading order.
- Each bullet says what that section should capture. Prefer concrete, outcome-focused guidance (owners and due dates on action items, decisions stated unambiguously, etc.).
- Keep the honesty rule: tell the assistant to only capture what was actually said and to mark anything unsupported as "Not discussed".
- NEVER mention tools, JSON, function calls, sourceSegmentIds, block types, origins, or any output format. Those are handled automatically and must not appear in the guidance.
- Keep it tight and readable. Match the style of the example below.`;

const EXAMPLE_USER = 'sales calls, figure out what the customer needs, objections, and next steps';

// One-shot target: a clean, guidance-only block in the house style (no mechanics terms).
const EXAMPLE_GUIDANCE = `You are enhancing notes for an external sales call. Capture what advances the deal, grounded strictly in the transcript and the user's notes. Cover these, marking any unsupported one "Not discussed":
- Summary: 2-3 sentences on who met, the purpose, and the headline outcome for the deal.
- Customer needs & priorities: the problems and goals the customer expressed, in their own words where possible.
- Objections & concerns: any pushback or hesitation raised, and how it was addressed.
- Commitments & agreements: what each side agreed to.
- Next steps: concrete next actions, each with an owner (ours or the customer's) and a date when stated.
Be precise with names, numbers, and dates; never invent them. Keep a neutral, factual tone.`;

export async function optimizeTemplateInstructions(
  input: OptimizeTemplateInput,
): Promise<OptimizeTemplateResult> {
  const namePart = input.name ? `Template name: ${input.name}\n\n` : '';
  const text = await completeText('optimize', {
    system: SYSTEM_PROMPT,
    maxTokens: MAX_TOKENS,
    messages: [
      // One-shot example in the house style so the model anchors on guidance-only output.
      { role: 'user', content: EXAMPLE_USER },
      { role: 'assistant', content: EXAMPLE_GUIDANCE },
      { role: 'user', content: `${namePart}${input.instructions.trim()}` },
    ],
  });

  if (!text.trim()) throw new Error('Optimize with AI returned no text. Try again.');
  return { instructions: text.trim() };
}
