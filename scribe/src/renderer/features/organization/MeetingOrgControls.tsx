import { useState } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import type { Folder, Tag } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { flattenFolders } from './use-organization';
import { NameDialog } from './NameDialog';

const NO_FOLDER = 'none';

// Folder + tag controls for the open meeting's header (ROADMAP_V04_04).
type MeetingOrgControlsProps = {
  meetingId: number;
  folderId: number | null;
  tagNames: string[];
  folders: Folder[];
  tags: Tag[];
  onSetFolder: (meetingId: number, folderId: number | null) => void;
  onAddTag: (meetingId: number, tagId: number) => void;
  onRemoveTag: (meetingId: number, tagId: number) => void;
  onCreateTag: (name: string) => Promise<Tag>;
};

export function MeetingOrgControls({
  meetingId,
  folderId,
  tagNames,
  folders,
  tags,
  onSetFolder,
  onAddTag,
  onRemoveTag,
  onCreateTag,
}: MeetingOrgControlsProps) {
  const [newTagOpen, setNewTagOpen] = useState(false);
  const meetingTagNames = new Set(tagNames);

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={folderId == null ? NO_FOLDER : String(folderId)}
        onValueChange={(v) => onSetFolder(meetingId, v === NO_FOLDER ? null : Number(v))}
      >
        <SelectTrigger size="sm" className="text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_FOLDER}>No folder</SelectItem>
          {flattenFolders(folders).map((f) => (
            <SelectItem key={f.id} value={String(f.id)}>
              {' '.repeat(f.depth * 2)}
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <TagIcon />
            Tags{tagNames.length > 0 ? ` (${tagNames.length})` : ''}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
          {tags.map((t) => {
            const checked = meetingTagNames.has(t.name);
            return (
              <DropdownMenuCheckboxItem
                key={t.id}
                checked={checked}
                onCheckedChange={(on) =>
                  on ? onAddTag(meetingId, t.id) : onRemoveTag(meetingId, t.id)
                }
                onSelect={(e) => e.preventDefault()}
              >
                {t.name}
              </DropdownMenuCheckboxItem>
            );
          })}
          {tags.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setNewTagOpen(true)}>New tag…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NameDialog
        open={newTagOpen}
        title="New tag"
        submitLabel="Create"
        maxLength={40}
        onClose={() => setNewTagOpen(false)}
        onSubmit={async (name) => {
          const tag = await onCreateTag(name);
          onAddTag(meetingId, tag.id);
        }}
      />
    </div>
  );
}
