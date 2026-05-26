import type { EnhancedNotes } from '../../../shared/types';

// Pure conversions between EnhancedNotes (stored JSON) and a ProseMirror document
// (what TipTap edits). Origin is carried as a myNote/aiNote mark on the text;
// sourceSegmentIds ride on the text-containing block's `sources` attribute so they
// survive edits (§8.4). Kept free of TipTap imports so it can be unit-tested.

type Origin = 'user' | 'ai';

export type PmNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: Array<{ type: string }>;
};

function textNode(text: string, origin: Origin): PmNode {
  return { type: 'text', text, marks: [{ type: origin === 'ai' ? 'aiNote' : 'myNote' }] };
}

function paragraphOf(text: string, origin: Origin, sources: number[]): PmNode {
  return {
    type: 'paragraph',
    attrs: { sources },
    content: text ? [textNode(text, origin)] : [],
  };
}

export function enhancedNotesToDoc(notes: EnhancedNotes): PmNode {
  const content: PmNode[] = [];
  const blocks = notes.blocks;
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === 'bullet') {
      const items: PmNode[] = [];
      while (i < blocks.length && blocks[i].type === 'bullet') {
        const b = blocks[i];
        items.push({ type: 'listItem', content: [paragraphOf(b.text, b.origin, b.sourceSegmentIds)] });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
    } else if (block.type === 'action_item') {
      const items: PmNode[] = [];
      while (i < blocks.length && blocks[i].type === 'action_item') {
        const b = blocks[i];
        items.push({
          type: 'taskItem',
          attrs: { checked: false },
          content: [paragraphOf(b.text, b.origin, b.sourceSegmentIds)],
        });
        i++;
      }
      content.push({ type: 'taskList', content: items });
    } else if (block.type === 'heading') {
      content.push({
        type: 'heading',
        attrs: { level: 2, sources: block.sourceSegmentIds },
        content: [textNode(block.text, block.origin)],
      });
      i++;
    } else {
      content.push(paragraphOf(block.text, block.origin, block.sourceSegmentIds));
      i++;
    }
  }
  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

function collectText(node: PmNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(collectText).join('');
}

// A block is "ai" only if every text run still carries the aiNote mark. Any user
// edit (typed text → unmarked or myNote) makes the whole block user-owned — the
// edit-flips-to-mine rule, observed at serialization time (PRODUCT_SPEC.md §8.3).
function originOf(node: PmNode): Origin {
  const texts: PmNode[] = [];
  const walk = (n: PmNode): void => {
    if (n.type === 'text') texts.push(n);
    (n.content ?? []).forEach(walk);
  };
  walk(node);
  if (texts.length === 0) return 'user';
  const allAi = texts.every((t) => (t.marks ?? []).some((m) => m.type === 'aiNote'));
  return allAi ? 'ai' : 'user';
}

function sourcesOf(node: PmNode): number[] {
  // For paragraph/heading the attr is on the node; for list/task items it's on
  // the inner paragraph.
  const direct = node.attrs?.sources;
  if (Array.isArray(direct)) return direct as number[];
  const inner = node.content?.[0]?.attrs?.sources;
  return Array.isArray(inner) ? (inner as number[]) : [];
}

export function docToEnhancedNotes(doc: PmNode): EnhancedNotes {
  const blocks: EnhancedNotes['blocks'] = [];
  for (const node of doc.content ?? []) {
    if (node.type === 'heading') {
      const text = collectText(node).trim();
      if (text)
        blocks.push({ type: 'heading', text, origin: originOf(node), sourceSegmentIds: sourcesOf(node) });
    } else if (node.type === 'paragraph') {
      const text = collectText(node).trim();
      if (text)
        blocks.push({ type: 'paragraph', text, origin: originOf(node), sourceSegmentIds: sourcesOf(node) });
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      for (const item of node.content ?? []) {
        const text = collectText(item).trim();
        if (text)
          blocks.push({ type: 'bullet', text, origin: originOf(item), sourceSegmentIds: sourcesOf(item) });
      }
    } else if (node.type === 'taskList') {
      for (const item of node.content ?? []) {
        const text = collectText(item).trim();
        if (text)
          blocks.push({ type: 'action_item', text, origin: originOf(item), sourceSegmentIds: sourcesOf(item) });
      }
    }
  }
  return { blocks };
}
