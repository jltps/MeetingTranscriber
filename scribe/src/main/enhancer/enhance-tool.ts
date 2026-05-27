// The structured-output schema for enhancement, shared by every provider (V06 block 05)
// so the Anthropic `tool` and the OpenAI-compatible `function` definition never drift.
// This is the app-owned JSON contract (CLAUDE.md §1.6); the matching Zod validator is
// EnhancedNotesSchema in shared/ipc-contract.ts.

export const ENHANCE_TOOL_NAME = 'emit_enhanced_notes';

export const ENHANCE_TOOL_DESCRIPTION =
  'Return the enhanced meeting notes as an ordered list of structured blocks, plus a short key-points summary.';

/** JSON Schema for the tool/function input. Mirrors EnhancedNotesSchema. */
export const ENHANCE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['heading', 'paragraph', 'bullet', 'action_item'] },
          text: { type: 'string' },
          origin: { type: 'string', enum: ['user', 'ai'] },
          sourceSegmentIds: { type: 'array', items: { type: 'number' } },
        },
        required: ['type', 'text', 'origin', 'sourceSegmentIds'],
      },
    },
    // Skimmable summary of the meeting's top takeaways (V06 block 03).
    keyPoints: { type: 'array', items: { type: 'string' } },
  },
  required: ['blocks', 'keyPoints'],
} as const;
