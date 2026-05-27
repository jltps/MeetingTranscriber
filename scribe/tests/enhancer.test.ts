import { describe, it, expect } from 'vitest';
import { EnhancedNotesSchema } from '../src/shared/ipc-contract';
import { repairBlocks } from '../src/main/enhancer/anthropic';
import { buildSystemPrompt } from '../src/main/enhancer/prompt';
import { stripAiTells, stripDashes } from '../src/main/enhancer/post-process';
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

  it('accepts optional keyPoints, and notes without them (V06 block 03 back-compat)', () => {
    const withKp = {
      blocks: [{ type: 'paragraph', text: 'x', origin: 'ai', sourceSegmentIds: [1] }],
      keyPoints: ['Decided to ship Friday', 'Owner: Ana'],
    };
    expect(EnhancedNotesSchema.parse(withKp)).toEqual(withKp);
    // Pre-V06 notes (no keyPoints) still validate.
    const noKp = { blocks: [{ type: 'heading', text: 'H', origin: 'ai', sourceSegmentIds: [] }] };
    expect(EnhancedNotesSchema.parse(noKp)).toEqual(noKp);
  });

  it('rejects a non-string-array keyPoints', () => {
    expect(() =>
      EnhancedNotesSchema.parse({ blocks: [], keyPoints: [1, 2, 3] }),
    ).toThrow();
  });
});

describe('buildSystemPrompt (V06 block 01 — scaffold + guidance slot)', () => {
  const SCAFFOLD_MARKER = 'emit_enhanced_notes';
  const SOURCE_MARKER = 'sourceSegmentIds';
  const CONTRACT_MARKER = 'MANDATORY CONTRACT';

  it('always emits the app-owned mechanics scaffold (with and without a template)', () => {
    const withTemplate = buildSystemPrompt({ templateInstructions: 'Focus on risks only.' });
    const without = buildSystemPrompt();
    for (const prompt of [withTemplate, without]) {
      expect(prompt).toContain(SCAFFOLD_MARKER);
      expect(prompt).toContain(SOURCE_MARKER);
    }
  });

  it('appends template guidance after the scaffold rather than replacing it', () => {
    const guidance = 'Focus strictly on budget figures and procurement steps.';
    const prompt = buildSystemPrompt({ templateInstructions: guidance });
    expect(prompt).toContain(SCAFFOLD_MARKER); // scaffold survives
    expect(prompt).toContain(guidance); // guidance is present
    // Scaffold comes before the guidance slot.
    expect(prompt.indexOf(SCAFFOLD_MARKER)).toBeLessThan(prompt.indexOf(guidance));
  });

  it('falls back to the default general guidance when no template is given', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('general business meeting');
  });

  it('keeps CONTRACT_SECTION as the last part of the prompt', () => {
    const prompt = buildSystemPrompt({
      templateInstructions: 'x',
      globalInstructions: 'y',
      detectedLanguage: 'pt-PT',
    });
    const contractIdx = prompt.indexOf(CONTRACT_MARKER);
    expect(contractIdx).toBeGreaterThan(-1);
    // Nothing of substance after the contract: it is the final section.
    expect(prompt.trimEnd().endsWith(prompt.slice(contractIdx).trimEnd())).toBe(true);
  });

  it('emits the language directive only when a language is provided', () => {
    expect(buildSystemPrompt({ detectedLanguage: 'pt-PT' })).toContain('pt-PT');
    expect(buildSystemPrompt()).not.toContain('Output language:');
  });

  it('includes the anti-AI-tell style directive before the contract (V06 block 04)', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Do NOT use em-dashes');
    expect(prompt.indexOf('Do NOT use em-dashes')).toBeLessThan(prompt.indexOf('MANDATORY CONTRACT'));
  });
});

describe('stripAiTells (V06 block 04 — clean ai output only)', () => {
  it('rewrites em/en dashes in ai blocks to commas', () => {
    expect(stripDashes('We shipped it — finally.')).toBe('We shipped it, finally.');
    expect(stripDashes('alpha–beta')).toBe('alpha, beta');
  });

  it('leaves numeric ranges intact', () => {
    expect(stripDashes('hire 3–5 people in Q2')).toBe('hire 3–5 people in Q2');
  });

  it('cleans ai-origin block text and leaves user blocks byte-for-byte', () => {
    const notes: EnhancedNotes = {
      blocks: [
        { type: 'paragraph', text: 'Plan — revised', origin: 'ai', sourceSegmentIds: [1] },
        { type: 'paragraph', text: 'My note — keep this', origin: 'user', sourceSegmentIds: [] },
      ],
    };
    const out = stripAiTells(notes);
    expect(out.blocks[0].text).toBe('Plan, revised');
    expect(out.blocks[1].text).toBe('My note — keep this'); // user untouched (§1.5)
  });

  it('cleans dashes inside keyPoints and tolerates their absence (V06 block 03)', () => {
    const withKp: EnhancedNotes = {
      blocks: [],
      keyPoints: ['Ship Friday — confirmed', 'No blockers'],
    };
    expect(stripAiTells(withKp).keyPoints).toEqual(['Ship Friday, confirmed', 'No blockers']);
    // No keyPoints field → output has none either.
    const noKp: EnhancedNotes = { blocks: [] };
    expect(stripAiTells(noKp).keyPoints).toBeUndefined();
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

  it('preserves a sibling keyPoints while fixing a block (V06 block 03)', () => {
    const repaired = repairBlocks({
      blocks: [{ type: 'user', text: 'mine', origin: 'paragraph', sourceSegmentIds: [] }],
      keyPoints: ['top takeaway'],
    });
    const parsed = EnhancedNotesSchema.parse(repaired);
    expect(parsed.keyPoints).toEqual(['top takeaway']);
    expect(parsed.blocks[0]).toEqual({ type: 'paragraph', text: 'mine', origin: 'user', sourceSegmentIds: [] });
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
