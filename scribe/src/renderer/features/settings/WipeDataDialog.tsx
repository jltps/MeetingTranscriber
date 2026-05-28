import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// V074 block 06 — typed-confirm gate for "Wipe all local data". The previous
// gate was a single native `window.confirm()`; one misclick wiped every
// meeting, transcript, note, template, and saved key. The user has to type
// the literal word WIPE (case-sensitive) before the destructive button
// enables.

const CONFIRM_PHRASE = 'WIPE';

type Props = {
  open: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

export function WipeDataDialog({ open, onConfirm, onClose }: Props) {
  const [typed, setTyped] = useState('');
  const [wiping, setWiping] = useState(false);
  const canConfirm = typed === CONFIRM_PHRASE && !wiping;

  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      setTyped('');
      onClose();
    }
  };

  const handleConfirm = async (): Promise<void> => {
    if (!canConfirm) return;
    setWiping(true);
    try {
      await onConfirm();
    } finally {
      setWiping(false);
      setTyped('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Wipe all local data?</DialogTitle>
          <DialogDescription>
            This will permanently delete every meeting, transcript, note, template,
            and saved API key. It cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="wipe-confirm" className="text-xs text-muted-foreground">
            Type <span className="font-mono font-semibold text-foreground">{CONFIRM_PHRASE}</span> to confirm.
          </label>
          <Input
            id="wipe-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`Type ${CONFIRM_PHRASE} to confirm`}
            // The dialog is summoned by an explicit destructive action; focusing
            // its single input is the expected behaviour and matches the
            // template-editor and name-dialog conventions in this repo.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={wiping}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={!canConfirm}
          >
            {wiping ? 'Wiping…' : 'Wipe everything'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
