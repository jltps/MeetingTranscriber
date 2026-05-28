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

// "About Nexus" modal (V07 block 02). Shows the installed version + links out
// to the GitHub Releases page and the repo via a typed IPC that asks main to
// open the URL with shell.openExternal — the renderer can never pass an
// arbitrary URL across the bridge.

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
            <Button variant="outline" size="sm" onClick={() => void window.api.openExternal('releases')}>
              Releases
            </Button>
            <Button variant="outline" size="sm" onClick={() => void window.api.openExternal('repo')}>
              Source
            </Button>
            <Button size="sm" onClick={onCheckUpdates}>
              Check for updates
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
