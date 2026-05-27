import { useEffect, useState } from 'react';
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

// Small reusable name prompt for creating/renaming a folder or creating a tag
// (ROADMAP_V04_04). Surfaces backend errors (e.g. a duplicate folder name) inline.
type NameDialogProps = {
  open: boolean;
  title: string;
  initialValue?: string;
  submitLabel?: string;
  maxLength?: number;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
};

export function NameDialog({
  open,
  title,
  initialValue = '',
  submitLabel = 'Save',
  maxLength = 80,
  onSubmit,
  onClose,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
      setBusy(false);
    }
  }, [open, initialValue]);

  const submit = async (): Promise<void> => {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">Enter a name.</DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          maxLength={maxLength}
          // Modal opens specifically to name something — moving focus into its only field is
          // the expected behavior, not a focus trap.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {error && <p className="text-[11px] text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!value.trim() || busy}>
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
