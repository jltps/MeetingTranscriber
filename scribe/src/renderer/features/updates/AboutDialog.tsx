import { useEffect, useState } from 'react';
import logoUrl from '../../assets/logo.svg';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// "About Nexus" modal (V07 block 02). Shows the installed version + a
// "Check for updates" trigger. V074 block 05 removed the Releases + Source
// outlinks — the V07 auto-updater makes Releases redundant, and the repo
// link doesn't belong in the consumer UI.

type Props = {
  open: boolean;
  onClose: () => void;
};

export function AboutDialog({ open, onClose }: Props) {
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    void window.api.getStatus().then((s) => setAppVersion(s.appVersion));
  }, [open]);

  const onCheckUpdates = (): void => {
    void window.api.updates.checkNow();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={logoUrl} alt="" className="size-5 rounded" />
            About Nexus
          </DialogTitle>
          <DialogDescription>
            Bot-free, device-audio meeting notepad for Windows.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Version</span>
            <span className="text-foreground">{appVersion ? `v${appVersion}` : '—'}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onCheckUpdates}>
              Check for updates
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
