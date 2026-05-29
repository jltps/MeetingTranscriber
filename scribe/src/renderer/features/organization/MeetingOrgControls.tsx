import { useState } from 'react';
import { Check, Plus, Tag as TagIcon } from 'lucide-react';
import type { Folder, Tag, Template } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { flattenFolders } from './use-organization';

const NO_FOLDER = 'none';
const NO_TEMPLATE = 'none';

// Template + folder + tag controls for the open meeting's header (ROADMAP_V04_04;
// V081 moves the template selector in here, first, and turns tags into a
// select-or-create combobox).
type MeetingOrgControlsProps = {
  meetingId: number;
  folderId: number | null;
  tagNames: string[];
  folders: Folder[];
  tags: Tag[];
  templates: Template[];
  templateId: number | null;
  onSetTemplate: (meetingId: number, templateId: number | null) => void;
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
  templates,
  templateId,
  onSetTemplate,
  onSetFolder,
  onAddTag,
  onRemoveTag,
  onCreateTag,
}: MeetingOrgControlsProps) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const applied = new Set(tagNames.map((n) => n.toLowerCase()));
  const q = query.trim();
  const filtered = tags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  const exactExists = tags.some((t) => t.name.toLowerCase() === q.toLowerCase());

  const toggleTag = (t: Tag): void => {
    if (applied.has(t.name.toLowerCase())) onRemoveTag(meetingId, t.id);
    else onAddTag(meetingId, t.id);
  };

  const createTag = async (): Promise<void> => {
    if (!q) return;
    const tag = await onCreateTag(q);
    onAddTag(meetingId, tag.id);
    setQuery('');
  };

  return (
    <div className="flex items-center gap-1.5">
      {/* V081: template selector first, before folders. */}
      <Select
        value={templateId == null ? NO_TEMPLATE : String(templateId)}
        onValueChange={(v) => onSetTemplate(meetingId, v === NO_TEMPLATE ? null : Number(v))}
      >
        <SelectTrigger size="sm" className="text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
          {templates.map((t) => (
            <SelectItem key={t.id} value={String(t.id)}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
              {' '.repeat(f.depth * 2)}
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* V081: tags select-or-create combobox — filter/pick existing or create inline. */}
      <Popover open={tagsOpen} onOpenChange={(o) => { setTagsOpen(o); if (!o) setQuery(''); }}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <TagIcon />
            Tags{tagNames.length > 0 ? ` (${tagNames.length})` : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-0">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Filter or create a tag…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {filtered.length === 0 && !q && <CommandEmpty>No tags yet — type to create one.</CommandEmpty>}
              <CommandGroup>
                {filtered.map((t) => {
                  const checked = applied.has(t.name.toLowerCase());
                  return (
                    <CommandItem key={t.id} value={t.name} onSelect={() => toggleTag(t)}>
                      <Check className={checked ? 'opacity-100' : 'opacity-0'} />
                      {t.name}
                    </CommandItem>
                  );
                })}
                {q && !exactExists && (
                  <CommandItem value={`__create__${q}`} onSelect={() => void createTag()}>
                    <Plus />
                    Create &ldquo;{q}&rdquo;
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
