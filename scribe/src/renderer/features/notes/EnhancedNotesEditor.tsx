import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import type { EnhancedNotes } from '../../../shared/types';
import { useDebouncedCallback } from '../../lib/debounce';
import { AiNote, EnhancedOwnership, MyNote } from './marks';
import { docToEnhancedNotes, enhancedNotesToDoc } from './enhanced-doc';

type EnhancedNotesEditorProps = {
  meetingId: number;
  notes: EnhancedNotes;
  onSave: (id: number, notes: EnhancedNotes) => void;
  editable?: boolean;
};

// Renders the merged enhanced notes with myNote/aiNote marks and persists edits
// (serialized back to EnhancedNotes) on a debounce. The edit-flips-to-mine rule
// lives in the EnhancedOwnership plugin (marks.ts). Edits do not feed back into
// the `notes` prop, so the cursor isn't reset mid-typing; `notes` changes only on
// meeting switch or a fresh enhancement.
export function EnhancedNotesEditor({
  meetingId,
  notes,
  onSave,
  editable = true,
}: EnhancedNotesEditorProps) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const dirty = useRef(false);

  const editor = useEditor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), MyNote, AiNote, EnhancedOwnership],
    editable,
    content: '',
    editorProps: { attributes: { class: 'notes-editor', 'data-testid': 'enhanced-editor' } },
    onUpdate: () => {
      dirty.current = true;
      debouncedSave();
    },
  });

  const save = (): void => {
    if (!editor || editor.isDestroyed || !dirty.current) return;
    dirty.current = false;
    onSaveRef.current(meetingId, docToEnhancedNotes(editor.getJSON() as never));
  };
  const debouncedSave = useDebouncedCallback(save, 700);

  // Load (and reload on a fresh enhancement) without tripping the flip plugin.
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.enhancedOwnership as { applying: boolean };
    storage.applying = true;
    editor.commands.setContent(enhancedNotesToDoc(notes) as never);
    storage.applying = false;
    dirty.current = false;
  }, [editor, notes]);

  // Flush pending edits when switching away / unmounting.
  useEffect(() => () => save(), []);

  return <EditorContent editor={editor} />;
}
