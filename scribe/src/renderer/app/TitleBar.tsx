import { Info, MessageSquare, PanelLeft, Settings } from 'lucide-react';
import logoUrl from '../assets/logo.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Custom title bar for the frameless window (ROADMAP_V04_03). The strip itself is
// draggable; the brand sits on the left and the global actions on the right. The
// OS-drawn window controls (min/max/close) float over the far right — the inner
// content is constrained to env(titlebar-area-width) so it never sits under them.
// Height (h-10 = 40px) must match TITLEBAR_HEIGHT in main/theme.ts. The brand is the
// Nexus monogram (renderer/assets/logo.svg) + wordmark (ROADMAP_V04_09).

type TitleBarProps = {
  onOpenSettings: () => void;
  onOpenCrossChat: () => void;
  onToggleSidebar: () => void;
  onOpenAbout: () => void;
};

export function TitleBar({ onOpenSettings, onOpenCrossChat, onToggleSidebar, onOpenAbout }: TitleBarProps) {
  return (
    <div className="titlebar-drag flex h-10 shrink-0 items-center border-b border-border bg-background">
      <div
        className="flex w-full items-center justify-between pr-2 pl-3"
        style={{ width: 'env(titlebar-area-width, 100%)' }}
      >
        <div className="titlebar-no-drag flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onToggleSidebar} aria-label="Toggle sidebar">
                <PanelLeft />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle sidebar</TooltipContent>
          </Tooltip>
          <span className="flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground">
            <img src={logoUrl} alt="" className="size-4 rounded-[3px]" />
            Nexus
          </span>
        </div>
        <div className="titlebar-no-drag flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onOpenCrossChat}
                aria-label="Ask across meetings"
              >
                <MessageSquare />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ask across meetings</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onOpenAbout} aria-label="About Nexus">
                <Info />
              </Button>
            </TooltipTrigger>
            <TooltipContent>About Nexus</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} aria-label="Settings">
                <Settings />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
