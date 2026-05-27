import type { Template } from '../../../shared/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type TemplatePickerModalProps = {
  templates: Template[];
  onSelect: (templateId: number | null) => void;
  onClose: () => void;
};

/**
 * Modal shown before creating a new note when more than the default "General"
 * template exists (FEATURES §C2). "No template" always available; built-ins
 * labelled with a badge. Designed to be fast — one click picks and closes.
 * Escape / overlay / close (X) skips (uses global settings).
 */
export function TemplatePickerModal({ templates, onSelect, onClose }: TemplatePickerModalProps) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-3 text-left">
          <DialogTitle className="text-sm">Choose a template</DialogTitle>
          <DialogDescription className="sr-only">
            Pick an enhancement template for this note, or skip to use your global settings.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-1 overflow-y-auto p-3">
          {/* "No template" always at top */}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="w-full rounded-md border border-input px-4 py-3 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <div className="font-medium">No template</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Use your global settings for enhancement.</div>
          </button>
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className="w-full rounded-md border border-input px-4 py-3 text-left text-sm hover:bg-muted"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{t.name}</span>
                {t.isBuiltin && (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    built-in
                  </span>
                )}
              </div>
              {t.instructions && (
                <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">
                  {t.instructions}
                </div>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
