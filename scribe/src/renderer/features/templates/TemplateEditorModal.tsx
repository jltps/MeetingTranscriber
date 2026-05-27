import { useState } from 'react';
import type { Template, TemplateCreate } from '../../../shared/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type TemplateEditorModalProps = {
  /** The template to edit, or null when creating a new one. */
  template: Template | null;
  onSave: (data: TemplateCreate) => Promise<void>;
  onClose: () => void;
};

/**
 * Modal for creating or editing a template. Opens over the Settings modal —
 * Radix stacks dialog portals by open order, so the editor sits on top.
 */
export function TemplateEditorModal({ template, onSave, onClose }: TemplateEditorModalProps) {
  const [name, setName] = useState(template?.name ?? '');
  const [instructions, setInstructions] = useState(template?.instructions ?? '');
  const [saving, setSaving] = useState(false);

  const isNew = template === null;
  const canSave = name.trim().length > 0 && !saving;

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        instructions,
        languageMode: template?.languageMode ?? 'global',
        languageCode: template?.languageCode ?? null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New template' : 'Edit template'}</DialogTitle>
          <DialogDescription className="sr-only">
            Define how Claude should structure and focus the meeting notes for this template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label className="text-sm text-muted-foreground">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm text-muted-foreground">Instructions</label>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="min-h-[18rem] resize-y"
            placeholder={
              'Describe how Claude should structure and focus the meeting notes.\n' +
              'e.g. "Highlight action items with owners and due dates. Summarize decisions made. Write in European Portuguese."'
            }
          />
          <p className="text-[11px] text-muted-foreground">
            Applied to enhancement in addition to your global instructions. Leave blank to use only
            the global instructions.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave}>
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
