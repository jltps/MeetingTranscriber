import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Two inline marks distinguish user-authored vs AI-added text (PRODUCT_SPEC.md
// §8.3). Rendered via data-note + a class; styling lives in app/index.css.
export const MyNote = Mark.create({
  name: 'myNote',
  parseHTML() {
    return [{ tag: 'span[data-note="user"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-note': 'user', class: 'note-user' }), 0];
  },
});

export const AiNote = Mark.create({
  name: 'aiNote',
  // Not inclusive: typing at a boundary doesn't extend the AI mark outward.
  inclusive: false,
  parseHTML() {
    return [{ tag: 'span[data-note="ai"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-note': 'ai', class: 'note-ai' }), 0];
  },
});

// The edit-flips-to-mine rule (PRODUCT_SPEC.md §8.3): any AI-marked text the user
// edits becomes user-owned. This plugin watches user transactions, finds the text
// ranges they touched, and converts aiNote → myNote there. Programmatic content
// loads set storage.applying so the initial render is NOT treated as a user edit.
export const EnhancedOwnership = Extension.create({
  name: 'enhancedOwnership',
  addStorage() {
    return { applying: false };
  },
  addProseMirrorPlugins() {
    // Same object as editor.storage.enhancedOwnership, which the editor toggles
    // around programmatic content loads.
    const storage = this.storage;
    return [
      new Plugin({
        key: new PluginKey('enhancedOwnership'),
        appendTransaction(transactions, _oldState, newState) {
          if (storage.applying) return null;
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (transactions.some((tr) => tr.getMeta('enhancedFlip') === true)) return null;

          const aiType = newState.schema.marks.aiNote;
          const myType = newState.schema.marks.myNote;
          if (!aiType || !myType) return null;

          const ranges: Array<[number, number]> = [];
          for (const tr of transactions) {
            tr.steps.forEach((_step, i) => {
              tr.mapping.maps[i]?.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                ranges.push([newStart, newEnd]);
              });
            });
          }
          if (ranges.length === 0) return null;

          const tr = newState.tr;
          const docSize = newState.doc.content.size;
          let changed = false;
          for (const [from, to] of ranges) {
            const start = Math.max(0, Math.min(from, docSize));
            const end = Math.max(0, Math.min(to, docSize));
            if (start >= end) continue;
            newState.doc.nodesBetween(start, end, (node, pos) => {
              if (node.isText && aiType.isInSet(node.marks)) {
                const flipFrom = Math.max(pos, start);
                const flipTo = Math.min(pos + node.nodeSize, end);
                if (flipFrom < flipTo) {
                  tr.removeMark(flipFrom, flipTo, aiType).addMark(flipFrom, flipTo, myType.create());
                  changed = true;
                }
              }
            });
          }
          if (!changed) return null;
          tr.setMeta('enhancedFlip', true);
          return tr;
        },
      }),
    ];
  },
});

// Carries the transcript segment ids an AI block was derived from (§8.4) as a
// node attribute, so they survive editing and round-trip through getJSON. Stored
// on the text-containing block (paragraph/heading) so the source icon sits next
// to the text.
export const SourceAttr = Extension.create({
  name: 'sourceAttr',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          sources: {
            default: [] as number[],
            parseHTML: (element) => {
              try {
                const raw = element.getAttribute('data-sources');
                return raw ? (JSON.parse(raw) as number[]) : [];
              } catch {
                return [];
              }
            },
            renderHTML: (attributes) => {
              const sources = attributes.sources as number[] | undefined;
              return sources && sources.length > 0
                ? { 'data-sources': JSON.stringify(sources) }
                : {};
            },
          },
        },
      },
    ];
  },
});

export interface SourceLinksOptions {
  onJump: (segmentIds: number[]) => void;
}

// Renders a non-editable "jump to transcript" widget next to any block that has
// source ids (§8.4). Clicking calls onJump with those ids; the transcript panel
// scrolls to and highlights them.
export const SourceLinks = Extension.create<SourceLinksOptions>({
  name: 'sourceLinks',
  addOptions() {
    return { onJump: () => {} };
  },
  addProseMirrorPlugins() {
    const onJump = (ids: number[]): void => this.options.onJump(ids);
    return [
      new Plugin({
        key: new PluginKey('sourceLinks'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
              const sources = node.attrs.sources as number[] | undefined;
              if (!sources || sources.length === 0) return;
              decorations.push(
                Decoration.widget(
                  pos + 1,
                  () => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'source-link';
                    button.setAttribute('contenteditable', 'false');
                    button.title = `Jump to transcript (${sources.length} segment${sources.length === 1 ? '' : 's'})`;
                    button.textContent = '⌕';
                    button.addEventListener('mousedown', (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onJump(sources);
                    });
                    return button;
                  },
                  { side: -1, key: `src-${pos}-${sources.join(',')}` },
                ),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
