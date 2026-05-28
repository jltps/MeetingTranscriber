import type { Template, TemplateCreate } from '../../../shared/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { TemplateEditor } from './TemplateEditor';

type TemplateEditorModalProps = {
  /** The template to edit, or null when creating a new one. */
  template: Template | null;
  onSave: (data: TemplateCreate) => Promise<void>;
  onClose: () => void;
};

/**
 * Modal wrapper around `<TemplateEditor>` for legacy callers (the per-meeting
 * "Edit template" affordance, command palette, etc.). V074 block 04 moved the
 * full create/edit workflow to the standalone `TemplatesPage`, but this Dialog
 * stays as a focused single-template edit surface that doesn't require leaving
 * the current meeting view.
 */
export function TemplateEditorModal({ template, onSave, onClose }: TemplateEditorModalProps) {
  const isNew = template === null;
  const handleSave = async (data: TemplateCreate): Promise<void> => {
    await onSave(data);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] w-full sm:max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New template' : 'Edit template'}</DialogTitle>
          <DialogDescription className="sr-only">
            Define what the enhanced meeting notes for this template should cover.
          </DialogDescription>
        </DialogHeader>
        <TemplateEditor
          template={template}
          onSave={handleSave}
          onCancel={onClose}
          variant="modal"
        />
      </DialogContent>
    </Dialog>
  );
}
