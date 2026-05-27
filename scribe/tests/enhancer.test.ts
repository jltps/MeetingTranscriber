import { describe, it, expect } from 'vitest';
import { EnhancedNotesSchema } from '../src/shared/ipc-contract';
import { repairBlocks } from '../src/main/enhancer/anthropic';
import {
  docToEnhancedNotes,
  enhancedNotesToDoc,
  type PmNode,
} from '../src/renderer/features/notes/enhanced-doc';
import type { EnhancedNotes } from '../src/shared/types';

describe('EnhancedNotesSchema', () => {
  it('accepts a valid EnhancedNotes payload', () => {
    const value: EnhancedNotes = {
      blocks: [
        { type: 'heading', text: 'Decisions', origin: 'ai', sourceSegmentIds: [3, 4] },
        { type: 'paragraph', text: 'My rough note', origin: 'user', sourceSegmentIds: [] },
      ],
    };
    expect(EnhancedNotesSchema.parse(value)).toEqual(value);
  });

  it('rejects an unknown block type or origin', () => {
    expect(() =>
      EnhancedNotesSchema.parse({
        blocks: [{ type: 'quote', text: 'x', origin: 'ai', sourceSegmentIds: [] }],
      }),
    ).toThrow();
    expect(() =>
      EnhancedNotesSchema.parse({
        blocks: [{ type: 'paragraph', text: 'x', origin: 'system', sourceSegmentIds: [] }],
      }),
    ).toThrow();
  });
});

describe('repairBlocks (type/origin recovery before degrading)', () => {
  it('un-swaps a clean type/origin swap and re-validates', () => {
    const repaired = repairBlocks({
      blocks: [{ type: 'bullet', text: 'ok', origin: 'ai', sourceSegmentIds: [1] }, { type: 'user', text: 'mine', origin: 'paragraph', sourceSegmentIds: [] }],
    });
    const parsed = EnhancedNotesSchema.parse(repaired);
    expect(parsed.blocks[1]).toEqual({ type: 'paragraph', text: 'mine', origin: 'user', sourceSegmentIds: [] });
  });

  it('coerces a stray origin-in-type (the observed failure) without losing text/ids', () => {
    // The exact logged case: type:"user" while origin is already a valid origin.
    const repaired = repairBlocks({
      blocks: [{ type: 'user', text: 'a point', origin: 'ai', sourceSegmentIds: [5, 6] }],
    });
    const parsed = EnhancedNotesSchema.parse(repaired);
    expect(parsed.blocks[0]).toEqual({ type: 'paragraph', text: 'a point', origin: 'ai', sourceSegmentIds: [5, 6] });
  });

  it('leaves a valid payload unchanged', () => {
    const value = { blocks: [{ type: 'heading', text: 'H', origin: 'ai', sourceSegmentIds: [2] }] };
    expect(EnhancedNotesSchema.parse(repairBlocks(value))).toEqual(value);
  });

  it('still fails for genuinely malformed blocks (bad text/ids) → degraded path', () => {
    const repaired = repairBlocks({
      blocks: [{ type: 'paragraph', text: 123, origin: 'ai', sourceSegmentIds: 'nope' }],
    });
    expect(EnhancedNotesSchema.safeParse(repaired).success).toBe(false);
  });
});

describe('enhancedNotesToDoc', () => {
  it('groups consecutive bullets/action items and marks origin', () => {
    const doc = enhancedNotesToDoc({
      blocks: [
        { type: 'heading', text: 'Notes', origin: 'user', sourceSegmentIds: [] },
        { type: 'bullet', text: 'point a', origin: 'ai', sourceSegmentIds: [1] },
        { type: 'bullet', text: 'point b', origin: 'ai', sourceSegmentIds: [2] },
        { type: 'action_item', text: 'do thing', origin: 'ai', sourceSegmentIds: [3] },
      ],
    });
    const types = doc.content?.map((n) => n.type);
    expect(types).toEqual(['heading', 'bulletList', 'taskList']);
    const firstBulletMark = doc.content?.[1].content?.[0].content?.[0].content?.[0].marks?.[0].type;
    expect(firstBulletMark).toBe('aiNote');
  });
});

describe('source ids round-trip (§8.4)', () => {
  it('carries sourceSegmentIds onto block attrs and back, surviving serialization', () => {
    const notes: EnhancedNotes = {
      blocks: [
        { type: 'paragraph', text: 'AI point', origin: 'ai', sourceSegmentIds: [5, 6] },
        { type: 'bullet', text: 'a bullet', origin: 'ai', sourceSegmentIds: [7] },
      ],
    };
    const doc = enhancedNotesToDoc(notes);
    expect(doc.content?.[0].attrs?.sources).toEqual([5, 6]);

    const back = docToEnhancedNotes(doc);
    expect(back.blocks[0].sourceSegmentIds).toEqual([5, 6]);
    expect(back.blocks[1].sourceSegmentIds).toEqual([7]);
  });
});

describe('docToEnhancedNotes (edit-flips-to-mine)', () => {
  it('treats a block as user-owned if any text run is not aiNote', () => {
    const doc: PmNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'AI part ', marks: [{ type: 'aiNote' }] },
            { type: 'text', text: 'edited by me', marks: [{ type: 'myNote' }] },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'pure ai', marks: [{ type: 'aiNote' }] }],
        },
      ],
    };
    const notes = docToEnhancedNotes(doc);
    expect(notes.blocks[0]).toMatchObject({ origin: 'user', text: 'AI part edited by me' });
    expect(notes.blocks[1]).toMatchObject({ origin: 'ai', text: 'pure ai' });
  });
});
