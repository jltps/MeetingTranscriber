import { TagIcon } from 'lucide-react';
import type { Tag } from '../../../shared/types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { OrganizationController } from './use-organization';

// Tag filter chips (ROADMAP_V04_04). Selecting tags narrows the list (AND across
// selected). Right-click a chip to delete the tag everywhere.
type TagFilterProps = {
  tags: Tag[];
  selectedTagIds: Set<number>;
  onToggle: (id: number) => void;
  org: OrganizationController;
};

export function TagFilter({ tags, selectedTagIds, onToggle, org }: TagFilterProps) {
  if (tags.length === 0) return null;
  return (
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
  );
}
