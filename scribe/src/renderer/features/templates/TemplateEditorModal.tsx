import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
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
import { STARTER_INSTRUCTIONS, TEMPLATE_SNIPPETS, insertSnippet } from './template-snippets';

type TemplateEditorModalProps = {
  /** The template to edit, or null when creating a new one. */
  template: Template | null;
  onSave: (data: TemplateCreate) => Promise<void>;
  onClose: () => void;
};

/**
 * Modal for creating or editing a template. Opens over the Settings modal —
 * Radix stacks dialog portals by open order, so the editor sits on top.
 *
 * Instructions are a GUIDANCE slot (V06 block 01): the app owns the output mechanics,
 * so this editor only deals with what the notes should cover. New templates prefill an
 * editable starter example; snippet buttons and "Optimize with AI" help author it.
 */
export function TemplateEditorModal({ template, onSave, onClose }: TemplateEditorModalProps) {
  const isNew = template === null;
  const [name, setName] = useState(template?.name ?? '');
  const [instructions, setInstructions] = useState(
    template?.instructions ?? STARTER_INSTRUCTIONS,
  );
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The selection at the last interaction, so a snippet lands where the caret was even
  // after the button takes focus. Defaults to the end of the text.
  const selectionRef = useRef<{ start: number; end: number }>({
    start: instructions.length,
    end: instructions.length,
  });
  // A pending caret position to restore after a controlled value change (snippet insert).
  const pendingCaret = useRef<number | null>(null);

  const canSave = name.trim().length > 0 && !saving && !optimizing;

  useEffect(() => {
    if (pendingCaret.current === null) return;
    const el = textareaRef.current;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    if (el) {
      el.focus();
      el.setSelectionRange(pos, pos);
      selectionRef.current = { start: pos, end: pos };
    }
  }, [instructions]);

  const rememberSelection = (el: HTMLTextAreaElement): void => {
    selectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const handleSnippet = (snippet: string): void => {
    const { start, end } = selectionRef.current;
    const result = insertSnippet(instructions, start, end, snippet);
    pendingCaret.current = result.cursor;
    setInstructions(result.value);
  };

  const handleOptimize = async (): Promise<void> => {
    if (!instructions.trim() || optimizing) return;
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const result = await window.api.templates.optimizeInstructions({
        instructions,
        name: name.trim() || undefined,
      });
      setInstructions(result.instructions);
      selectionRef.current = {
        start: result.instructions.length,
        end: result.instructions.length,
      };
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : 'Optimize with AI failed. Try again.');
    } finally {
      setOptimizing(false);
    }
  };

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
      <DialogContent className="flex max-h-[85vh] w-full sm:max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New template' : 'Edit template'}</DialogTitle>
          <DialogDescription className="sr-only">
            Define what the enhanced meeting notes for this template should cover.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Template name"
              // Editor opens to author a template — focusing its first field on open is expected.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Instructions</label>

            {/* Snippet toolbar — inserts guidance at the cursor (V06 block 02). */}
            <div className="flex flex-wrap gap-1">
              {TEMPLATE_SNIPPETS.map((s) => (
                <Button
                  key={s.label}
                  variant="outline"
                  size="xs"
                  onClick={() => handleSnippet(s.text)}
                  title={s.text}
                >
                  + {s.label}
                </Button>
              ))}
            </div>

            <Textarea
              ref={textareaRef}
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value);
                rememberSelection(e.currentTarget);
              }}
              onSelect={(e) => rememberSelection(e.currentTarget)}
              className="min-h-[20rem] max-h-[50vh] resize-y overflow-y-auto"
              placeholder={
                'Describe what the enhanced notes for this meeting type should cover.\n' +
                'e.g. "Highlight action items with owners and due dates. Summarize decisions made. Write in European Portuguese."'
              }
            />

            {/* Optimize-with-AI: centered below the prompt with a branded teal→blue
                accent (the palette's --primary and --info) so it reads as the special action. */}
            <div className="flex flex-col items-center gap-1 pt-1">
              <Button
                size="sm"
                onClick={() => void handleOptimize()}
                disabled={optimizing || !instructions.trim()}
                title="Rewrite your instructions into clear, structured guidance"
                className="bg-gradient-to-r from-primary to-info text-white shadow-sm hover:opacity-90"
              >
                <Sparkles />
                {optimizing ? 'Optimizing…' : 'Optimize with AI'}
              </Button>
              {optimizeError && <p className="text-[11px] text-destructive">{optimizeError}</p>}
            </div>

            <p className="text-[11px] text-muted-foreground">
              {isNew ? 'A starting point — edit, replace, or clear it. ' : ''}
              Applied to enhancement in addition to your global instructions. The output format and
              source-linking are handled automatically. Leave blank to use only the global instructions.
            </p>
          </div>
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
