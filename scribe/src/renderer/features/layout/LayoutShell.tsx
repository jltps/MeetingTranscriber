import type { ReactNode, Ref } from 'react';
import { Panel, type ImperativePanelHandle } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import type { LayoutMode } from './use-responsive';

// The app shell (ROADMAP_V04_06): sidebar + main. Wide = a resizable, collapsible
// sidebar panel beside main (sizes persisted via autoSaveId). Narrow = main fills
// the width and the sidebar is a slide-over drawer. `main` is passed as children so
// it isn't duplicated across the two layouts.
type LayoutShellProps = {
  mode: LayoutMode;
  sidebar: ReactNode;
  /** Imperative handle to the wide-mode sidebar panel (collapse/expand). */
  sidebarRef: Ref<ImperativePanelHandle>;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  children: ReactNode;
};

export function LayoutShell({
  mode,
  sidebar,
  sidebarRef,
  drawerOpen,
  onCloseDrawer,
  children,
}: LayoutShellProps) {
  if (mode === 'wide') {
    return (
      <ResizablePanelGroup direction="horizontal" autoSaveId="scribe:shell" className="min-h-0 flex-1">
        <Panel
          ref={sidebarRef}
          id="sidebar"
          order={1}
          collapsible
          collapsedSize={0}
          defaultSize={22}
          minSize={16}
          maxSize={32}
          className="overflow-hidden"
        >
          {sidebar}
        </Panel>
        <ResizableHandle />
        <ResizablePanel id="main" order={2} className="min-h-0">
          {children}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  // Narrow: main fills; sidebar is a drawer over it.
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {children}
      {drawerOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onCloseDrawer}
            className="absolute inset-0 z-30 cursor-default bg-black/50"
          />
          <div className="absolute inset-y-0 left-0 z-40 w-72 border-r border-border bg-card shadow-xl">
            {sidebar}
          </div>
        </>
      )}
    </div>
  );
}
