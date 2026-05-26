import type { Template } from '../../../shared/types';

type TemplatePickerModalProps = {
  templates: Template[];
  onSelect: (templateId: number | null) => void;
  onClose: () => void;
};

/**
 * Modal shown before creating a new note when more than the default "General"
 * template exists (FEATURES §C2). "No template" always available; built-ins
 * labelled with a badge. Designed to be fast — one click picks and closes.
 */
export function TemplatePickerModal({ templates, onSelect, onClose }: TemplatePickerModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">Choose a template</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            Skip
          </button>
        </div>
        <div className="overflow-y-auto p-3 space-y-1">
          {/* "No template" always at top */}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="w-full rounded-md border border-neutral-700 px-4 py-3 text-left text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <div className="font-medium">No template</div>
            <div className="text-[11px] text-neutral-500 mt-0.5">Use your global settings for enhancement.</div>
          </button>
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className="w-full rounded-md border border-neutral-700 px-4 py-3 text-left text-sm hover:bg-neutral-800"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-neutral-200">{t.name}</span>
                {t.isBuiltin && (
                  <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                    built-in
                  </span>
                )}
              </div>
              {t.instructions && (
                <div className="mt-0.5 text-[11px] text-neutral-500 line-clamp-2">
                  {t.instructions}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
