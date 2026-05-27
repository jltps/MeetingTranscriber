import { describe, it, expect } from 'vitest';
import { parseEnhanceArguments } from '../src/main/llm/openai-compatible';
import { EnhancedNotesSchema } from '../src/shared/ipc-contract';

// The OpenAI-compatible provider returns the structured output as a function-call
// arguments string. parseEnhanceArguments must JSON-parse + validate it against the same
// contract as Anthropic, recover a clean type/origin swap, and return null on garbage so
// the caller degrades to the markdown fallback (V06 block 05). Pure — no network.
describe('parseEnhanceArguments', () => {
  it('parses a valid tool-call payload (with keyPoints) into validated notes', () => {
    const args = JSON.stringify({
      blocks: [
        { type: 'heading', text: 'Decisions', origin: 'ai', sourceSegmentIds: [2] },
        { type: 'paragraph', text: 'My note', origin: 'user', sourceSegmentIds: [] },
      ],
      keyPoints: ['Ship Friday', 'Owner: Ana'],
    });
    const notes = parseEnhanceArguments(args);
    expect(notes).not.toBeNull();
    expect(EnhancedNotesSchema.safeParse(notes).success).toBe(true);
    expect(notes!.keyPoints).toEqual(['Ship Friday', 'Owner: Ana']);
  });

  it('recovers a clean type/origin swap via repairBlocks', () => {
    const args = JSON.stringify({
      blocks: [{ type: 'user', text: 'mine', origin: 'paragraph', sourceSegmentIds: [] }],
      keyPoints: [],
    });
    const notes = parseEnhanceArguments(args);
    expect(notes!.blocks[0]).toEqual({
      type: 'paragraph',
      text: 'mine',
      origin: 'user',
      sourceSegmentIds: [],
    });
  });

  it('returns null for non-JSON or missing arguments (→ markdown fallback)', () => {
    expect(parseEnhanceArguments('not json {')).toBeNull();
    expect(parseEnhanceArguments(undefined)).toBeNull();
    // Structurally wrong (blocks not an array of valid blocks) and unrecoverable.
    expect(parseEnhanceArguments(JSON.stringify({ blocks: [{ text: 123 }] }))).toBeNull();
  });
});
