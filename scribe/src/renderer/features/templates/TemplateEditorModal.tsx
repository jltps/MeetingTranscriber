import { useState } from 'react';
import type { Template, TemplateCreate } from '../../../shared/types';

type TemplateEditorModalProps = {
  /** The template to edit, or null when creating a new one. */
  template: Template | null;
  onSave: (data: TemplateCreate) => Promise<void>;
  onClose: () => void;
};

/**
 * Full-size modal for creating or editing a template.
 * Opens over the Settings modal (z-[60] vs z-50) so both are visible as layers.
 * Wider container and tall resizable textarea make long instruction prompts readable.
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold text-foreground">
            {isNew ? 'New template' : 'Edit template'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Template name"
              autoFocus
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
            />
          </div>

          <div className="flex flex-1 flex-col space-y-1.5">
            <label className="text-sm text-muted-foreground">Instructions</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={16}
              placeholder={
                'Describe how Claude should structure and focus the meeting notes.\n' +
                'e.g. "Highlight action items with owners and due dates. Summarize decisions made. Write in European Portuguese."'
              }
              className="w-full flex-1 resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
            />
            <p className="text-[11px] text-muted-foreground">
              Applied to enhancement in addition to your global instructions. Leave blank to use only
              the global instructions.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
