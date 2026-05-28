import { useState } from 'react';
import { Plus, TagIcon } from 'lucide-react';
import type { Tag } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { OrganizationController } from './use-organization';
import { NameDialog } from './NameDialog';

// Tag filter chips (ROADMAP_V04_04). Selecting tags narrows the list (AND across
// selected). Right-click a chip to delete the tag everywhere. A "Tags" header
// with a + button mirrors FolderTree's affordance so tags can be created from
// the sidebar without first opening a meeting.
type TagFilterProps = {
  tags: Tag[];
  selectedTagIds: Set<number>;
  onToggle: (id: number) => void;
  org: OrganizationController;
};

export function TagFilter({ tags, selectedTagIds, onToggle, org }: TagFilterProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tags
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New tag"
          onClick={() => setDialogOpen(true)}
        >
          <Plus />
        </Button>
      </div>

      {tags.length === 0 ? (
        <p className="px-2 py-1 text-[10px] text-muted-foreground">
          No tags yet — use + to create one.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1 px-1">
          {tags.map((t) => {
            const active = selectedTagIds.has(t.id);
            return (
              <ContextMenu key={t.id}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onToggle(t.id)}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    <TagIcon className="size-2.5" />
                    {t.name}
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => {
                      if (window.confirm(`Delete tag "${t.name}" from all meetings?`)) {
                        void org.deleteTag(t.id);
                      }
                    }}
                  >
                    Delete tag
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      )}

      <NameDialog
        open={dialogOpen}
        title="New tag"
        submitLabel="Create"
        onClose={() => setDialogOpen(false)}
        onSubmit={async (name) => {
          await org.createTag(name);
        }}
      />
    </div>
  );
}
