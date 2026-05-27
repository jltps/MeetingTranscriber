import { useState } from 'react';
import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderPlus, Inbox } from 'lucide-react';
import type { Folder } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { flattenFolders, foldersWithChildren, type OrganizationController } from './use-organization';
import { NameDialog } from './NameDialog';

type DialogState =
  | { mode: 'new'; parentId: number | null }
  | { mode: 'rename'; id: number; initial: string }
  | null;

/** Ids of a folder's descendants (for excluding invalid move targets). */
function descendantIds(folders: Folder[], id: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const f of folders) {
    if (f.parentId !== null) {
      const list = childrenOf.get(f.parentId) ?? [];
      list.push(f.id);
      childrenOf.set(f.parentId, list);
    }
  }
  const out = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenOf.get(cur) ?? []) {
      out.add(c);
      stack.push(c);
    }
  }
  return out;
}

type FolderTreeProps = {
  folders: Folder[];
  org: OrganizationController;
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
};

export function FolderTree({ folders, org, selectedFolderId, onSelectFolder }: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);

  const hasChildren = foldersWithChildren(folders);
  const nodes = flattenFolders(folders, expanded);

  const toggle = (id: number): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
      }
      return next;
    });

  const moveTargets = (folderId: number): Folder[] => {
    const blocked = descendantIds(folders, folderId);
    blocked.add(folderId);
    return folders.filter((f) => !blocked.has(f.id));
  };

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Folders
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New folder"
          onClick={() => setDialog({ mode: 'new', parentId: null })}
        >
          <FolderPlus />
        </Button>
      </div>

      <div role="tree" aria-label="Folders" className="space-y-0.5">
      {/* All notes */}
      <button
        type="button"
        role="treeitem"
        aria-selected={selectedFolderId === null}
        onClick={() => onSelectFolder(null)}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          selectedFolderId === null ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'
        }`}
      >
        <Inbox className="size-3.5" />
        All notes
      </button>

      {folders.length === 0 && (
        <p className="px-2 py-1 text-[10px] text-muted-foreground">
          No folders yet — use + to create one.
        </p>
      )}

      {nodes.map((node) => {
        const expandable = hasChildren.has(node.id);
        const isOpen = expanded.has(node.id);
        return (
          <ContextMenu key={node.id}>
            <ContextMenuTrigger asChild>
              <div
                role="treeitem"
                tabIndex={0}
                aria-selected={selectedFolderId === node.id}
                aria-expanded={expandable ? isOpen : undefined}
                onClick={() => onSelectFolder(node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelectFolder(node.id);
                }}
                style={{ paddingLeft: `${node.depth * 12 + 8}px` }}
                className={`flex w-full cursor-pointer items-center gap-1 rounded py-1 pr-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                  selectedFolderId === node.id
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {expandable ? (
                  <button
                    type="button"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(node.id);
                    }}
                    className="shrink-0 rounded p-0.5 hover:bg-muted"
                  >
                    {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <FolderIcon className="size-3.5 shrink-0" />
                <span className="truncate">{node.name}</span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => setDialog({ mode: 'rename', id: node.id, initial: node.name })}>
                Rename
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => setDialog({ mode: 'new', parentId: node.id })}>
                New subfolder
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem onSelect={() => void org.moveFolder(node.id, null)}>
                    Top level
                  </ContextMenuItem>
                  {moveTargets(node.id).map((t) => (
                    <ContextMenuItem key={t.id} onSelect={() => void org.moveFolder(node.id, t.id)}>
                      {t.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => {
                  if (window.confirm(`Delete folder "${node.name}"? Its notes are kept (unfiled).`)) {
                    if (selectedFolderId === node.id) onSelectFolder(null);
                    void org.deleteFolder(node.id);
                  }
                }}
              >
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      </div>

      <NameDialog
        open={dialog !== null}
        title={dialog?.mode === 'rename' ? 'Rename folder' : 'New folder'}
        initialValue={dialog?.mode === 'rename' ? dialog.initial : ''}
        submitLabel={dialog?.mode === 'rename' ? 'Rename' : 'Create'}
        onClose={() => setDialog(null)}
        onSubmit={async (name) => {
          if (dialog?.mode === 'rename') await org.renameFolder(dialog.id, name);
          else if (dialog?.mode === 'new') {
            const created = await org.createFolder(name, dialog.parentId);
            if (dialog.parentId !== null) setExpanded((p) => new Set(p).add(dialog.parentId!));
            onSelectFolder(created.id);
          }
        }}
      />
    </div>
  );
}
