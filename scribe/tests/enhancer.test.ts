import { describe, it, expect } from 'vitest';
import { EnhancedNotesSchema } from '../src/shared/ipc-contract';
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
