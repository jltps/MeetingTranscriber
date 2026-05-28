import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import type { Template, TemplateCreate } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TemplateEditor } from './TemplateEditor';

// V074 block 04 — full-screen templates workspace. Replaces the stacked sub-Dialog
// previously rendered inside Settings. Layout: top bar with Back / title / + New;
// left list of templates (scrollable); right pane is <TemplateEditor> for the
// selected template or a new draft. Owns its own selection + draft state; calls
// onChanged after any mutation so the App-level templates list refreshes.

// 'new' = the user has clicked "+ New" but not yet saved.
type Selection = { kind: 'existing'; id: number } | { kind: 'new' };

type Props = {
  templates: Template[];
  onChanged: () => void;
  onBack: () => void;
};

export function TemplatesPage({ templates, onChanged, onBack }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draftKey, setDraftKey] = useState(0);

  // Default selection: first template on first render. Falls through to 'new'
  // when the list is empty so the user lands in an authoring surface.
  useEffect(() => {
    if (selection !== null) return;
    if (templates.length > 0) {
      setSelection({ kind: 'existing', id: templates[0]!.id });
    } else {
      setSelection({ kind: 'new' });
    }
  }, [templates, selection]);

  // If the currently-selected template disappears (deleted elsewhere), fall back
  // to the first row.
  useEffect(() => {
    if (selection?.kind !== 'existing') return;
    if (!templates.some((t) => t.id === selection.id)) {
      setSelection(templates.length > 0 ? { kind: 'existing', id: templates[0]!.id } : { kind: 'new' });
    }
  }, [templates, selection]);

  const selectedTemplate: Template | null = useMemo(() => {
    if (selection?.kind !== 'existing') return null;
    return templates.find((t) => t.id === selection.id) ?? null;
  }, [selection, templates]);

  const handleSave = async (data: TemplateCreate): Promise<void> => {
    if (selection?.kind === 'existing') {
      await window.api.templates.update(selection.id, data);
      onChanged();
    } else {
      const created = await window.api.templates.create(data);
      onChanged();
      setSelection({ kind: 'existing', id: created.id });
    }
  };

  const handleDelete = async (t: Template): Promise<void> => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    await window.api.templates.remove(t.id);
    onChanged();
  };

  const handleNew = (): void => {
    setSelection({ kind: 'new' });
    // Bump the draft key so the editor re-mounts with fresh starter instructions
    // if the user clicks "+ New" while already on a draft.
    setDraftKey((k) => k + 1);
  };

  const handleCancel = (): void => {
    // Cancelling a draft falls back to the first existing template (or stays on
    // the empty draft if there are none). Cancelling an existing edit re-selects
    // the row so the editor remounts with the saved values.
    if (selection?.kind === 'new') {
      if (templates.length > 0) setSelection({ kind: 'existing', id: templates[0]!.id });
      else setDraftKey((k) => k + 1);
    } else if (selection?.kind === 'existing') {
      const id = selection.id;
      setSelection(null);
      // Defer to next tick so the effect re-runs and re-selects, remounting the editor.
      setTimeout(() => setSelection({ kind: 'existing', id }), 0);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft />
          Back
        </Button>
        <h1 className="text-sm font-semibold text-foreground">Templates</h1>
        <Button size="sm" onClick={handleNew}>
          <Plus />
          New
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr]">
        <aside className="overflow-y-auto border-r border-border bg-card">
          <ul className="space-y-0.5 p-2">
            {templates.map((t) => {
              const active = selection?.kind === 'existing' && selection.id === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelection({ kind: 'existing', id: t.id })}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-accent',
                    )}
                  >
                    <span className="w-full truncate text-sm font-medium">{t.name}</span>
                    {t.instructions && (
                      <span className="line-clamp-1 w-full text-[11px] text-muted-foreground">
                        {t.instructions}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {selection?.kind === 'new' && (
              <li>
                <div className="rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                  New template
                  <p className="text-[11px] text-muted-foreground">Unsaved draft</p>
                </div>
              </li>
            )}
          </ul>
        </aside>

        <main className="flex min-h-0 flex-col overflow-hidden p-5">
          {selection?.kind === 'existing' && selectedTemplate && (
            <>
              <div className="mb-3 flex items-center justify-end">
                <Button
                  variant="link"
                  size="xs"
                  className="text-destructive"
                  onClick={() => void handleDelete(selectedTemplate)}
                >
                  Delete template
                </Button>
              </div>
              <TemplateEditor
                key={`existing-${selectedTemplate.id}`}
                template={selectedTemplate}
                onSave={handleSave}
                onCancel={handleCancel}
                variant="page"
                autoFocusName={false}
              />
            </>
          )}
          {selection?.kind === 'new' && (
            <TemplateEditor
              key={`new-${draftKey}`}
              template={null}
              onSave={handleSave}
              onCancel={handleCancel}
              variant="page"
              autoFocusName
            />
          )}
        </main>
      </div>
    </div>
  );
}
