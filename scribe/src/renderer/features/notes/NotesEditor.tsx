import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { useDebouncedCallback } from '../../lib/debounce';

type NotesEditorProps = {
  meetingId: number;
  initialMarkdown: string;
  onSave: (id: number, markdown: string) => void;
  editable?: boolean;
};

// TipTap editor that persists notes as Markdown (PRODUCT_SPEC.md §8.1, §11). The
// parent keys this by meetingId so each meeting gets a fresh editor seeded with
// its saved notes. Edits autosave on a debounce and flush on unmount/switch so
// nothing is lost. meetingId is captured per-instance, so the unmount flush
// always targets the right meeting even after the selection changes.
export function NotesEditor({ meetingId, initialMarkdown, onSave, editable = true }: NotesEditorProps) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const latest = useRef(initialMarkdown);
  const dirty = useRef(false);

  const flush = (): void => {
    if (!dirty.current) return;
    dirty.current = false;
    onSaveRef.current(meetingId, latest.current);
  };
  const debouncedFlush = useDebouncedCallback(flush, 700);

  const editor = useEditor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Markdown],
    content: initialMarkdown,
    editable,
    editorProps: {
      attributes: { class: 'notes-editor', 'data-testid': 'notes-editor' },
    },
    onUpdate: ({ editor: instance }) => {
      latest.current = instance.storage.markdown.getMarkdown();
      dirty.current = true;
      debouncedFlush();
    },
  });

  useEffect(() => () => flush(), []);

  return <EditorContent editor={editor} />;
}
