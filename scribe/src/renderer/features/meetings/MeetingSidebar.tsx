import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FileText, MessageSquare, Plus, Search, SearchX, X } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import type { Folder, MeetingStatus, MeetingSummary, Tag, Template } from '../../../shared/types';
import { useDebouncedCallback } from '../../lib/debounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { FolderTree } from '../organization/FolderTree';
import { TagFilter } from '../organization/TagFilter';
import { NameDialog } from '../organization/NameDialog';
import { flattenFolders, type OrganizationController } from '../organization/use-organization';

type SortKey = 'updated' | 'created' | 'title';

function statusDot(status: MeetingStatus): string {
  if (status === 'transcribing') return 'bg-destructive animate-pulse';
  if (status === 'ended') return 'bg-primary';
  return 'bg-muted-foreground';
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type DateBucket = 'Today' | 'Yesterday' | 'This week' | 'Earlier';
const BUCKET_ORDER: DateBucket[] = ['Today', 'Yesterday', 'This week', 'Earlier'];

function dateBucket(ms: number): DateBucket {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startToday) return 'Today';
  if (ms >= startToday - 86_400_000) return 'Yesterday';
  if (ms >= startToday - 6 * 86_400_000) return 'This week';
  return 'Earlier';
}

const sortValue = (m: MeetingSummary, key: SortKey): number =>
  key === 'created' ? m.createdAt : (m.updatedAt ?? m.createdAt);

type MeetingSidebarProps = {
  meetings: MeetingSummary[];
  templates: Template[];
  folders: Folder[];
  tags: Tag[];
  org: OrganizationController;
  selectedId: number | null;
  searching: boolean;
  disabled: boolean; // selection locked while recording
  onSelect: (id: number) => void;
  onNew: (folderId: number | null) => void;
  onSearch: (query: string) => void;
  onDelete: (id: number) => void;
  onSetMeetingFolder: (meetingId: number, folderId: number | null) => void;
  onAddMeetingTag: (meetingId: number, tagId: number) => void;
  onRemoveMeetingTag: (meetingId: number, tagId: number) => void;
  onOpenCrossChat: () => void;
  agendaSlot?: ReactNode;
};

export function MeetingSidebar({
  meetings,
  templates,
  folders,
  tags,
  org,
  selectedId,
  searching,
  disabled,
  onSelect,
  onNew,
  onSearch,
  onDelete,
  onSetMeetingFolder,
  onAddMeetingTag,
  onRemoveMeetingTag,
  onOpenCrossChat,
  agendaSlot,
}: MeetingSidebarProps) {
  const [text, setText] = useState('');
  const debouncedSearch = useDebouncedCallback(onSearch, 250);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<SortKey>('updated');
  // Meeting id for which the row's "New tag…" dialog is open.
  const [newTagFor, setNewTagFor] = useState<number | null>(null);

  const selectedTagNames = useMemo(
    () => new Set(tags.filter((t) => selectedTagIds.has(t.id)).map((t) => t.name)),
    [tags, selectedTagIds],
  );

  // Client-side filter (folder = direct membership; tags = AND) then sort.
  const filtered = useMemo(() => {
    let list = meetings;
    if (selectedFolderId !== null) list = list.filter((m) => m.folderId === selectedFolderId);
    if (selectedTagNames.size > 0) {
      list = list.filter((m) => [...selectedTagNames].every((n) => m.tags.includes(n)));
    }
    const sorted = [...list];
    if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else sorted.sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
    return sorted;
  }, [meetings, selectedFolderId, selectedTagNames, sort]);

  // Group by date for date sorts; a single flat group for title sort.
  const groups = useMemo(() => {
    if (sort === 'title') return [{ label: null as string | null, items: filtered }];
    const byBucket = new Map<DateBucket, MeetingSummary[]>();
    for (const m of filtered) {
      const b = dateBucket(sortValue(m, sort));
      const list = byBucket.get(b) ?? [];
      list.push(m);
      byBucket.set(b, list);
    }
    return BUCKET_ORDER.filter((b) => byBucket.has(b)).map((b) => ({
      label: b as string | null,
      items: byBucket.get(b)!,
    }));
  }, [filtered, sort]);

  const toggleTag = (id: number): void =>
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-card">
      <div className="space-y-2 border-b border-border p-3">
        <Button size="sm" onClick={() => onNew(selectedFolderId)} className="w-full">
          <Plus />
          New Note
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            data-search-input
            value={text}
            placeholder="Search notes & transcripts"
            onChange={(e) => {
              setText(e.target.value);
              debouncedSearch(e.target.value);
            }}
            className="h-8 pl-8 text-xs"
          />
        </div>
        {/* Ask-across-notes (V072 block 03). Moved here from the TitleBar so the
            cross-meeting entry point sits with the rest of the notes navigation
            (search, folders, tags). AI gradient = variant="ai". */}
        <Button
          variant="ai"
          size="sm"
          onClick={onOpenCrossChat}
          aria-label="Ask across notes"
          className="w-full"
        >
          <MessageSquare />
          Ask across notes
        </Button>
      </div>

      <div className="space-y-2 border-b border-border p-2">
        <FolderTree
          folders={folders}
          org={org}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
        />
        <TagFilter tags={tags} selectedTagIds={selectedTagIds} onToggle={toggleTag} org={org} />
      </div>

      {agendaSlot}

      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Notes
        </span>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger size="sm" className="h-6 gap-1 border-none px-1 text-[11px] shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="updated">Last updated</SelectItem>
            <SelectItem value="created">Date created</SelectItem>
            <SelectItem value="title">Title</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          searching ? (
            <EmptyState compact icon={SearchX} title="No matches" description="Try a different search." />
          ) : (
            <EmptyState
              compact
              icon={FileText}
              title="No notes here"
              description="Create a note to start capturing a meeting."
              action={{ label: 'New note', onClick: () => onNew(selectedFolderId) }}
            />
          )
        ) : (
          groups.map((group) => (
            <div key={group.label ?? 'all'}>
              {group.label && (
                <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
              )}
              <ul aria-label={group.label ? `Meetings — ${group.label}` : 'Meetings'}>
                {group.items.map((m) => (
                  <MeetingRow
                    key={m.id}
                    meeting={m}
                    templates={templates}
                    folders={folders}
                    tags={tags}
                    selected={m.id === selectedId}
                    disabled={disabled}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onSetFolder={onSetMeetingFolder}
                    onAddTag={onAddMeetingTag}
                    onRemoveTag={onRemoveMeetingTag}
                    onNewTag={() => setNewTagFor(m.id)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <NameDialog
        open={newTagFor !== null}
        title="New tag"
        submitLabel="Create"
        maxLength={40}
        onClose={() => setNewTagFor(null)}
        onSubmit={async (name) => {
          const tag = await org.createTag(name);
          if (newTagFor !== null) onAddMeetingTag(newTagFor, tag.id);
        }}
      />
    </aside>
  );
}

type MeetingRowProps = {
  meeting: MeetingSummary;
  templates: Template[];
  folders: Folder[];
  tags: Tag[];
  selected: boolean;
  disabled: boolean;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onSetFolder: (meetingId: number, folderId: number | null) => void;
  onAddTag: (meetingId: number, tagId: number) => void;
  onRemoveTag: (meetingId: number, tagId: number) => void;
  onNewTag: () => void;
};

function MeetingRow({
  meeting: m,
  templates,
  folders,
  tags,
  selected,
  disabled,
  onSelect,
  onDelete,
  onSetFolder,
  onAddTag,
  onRemoveTag,
  onNewTag,
}: MeetingRowProps) {
  const templateName = m.templateId ? templates.find((t) => t.id === m.templateId)?.name : null;
  const meetingTags = new Set(m.tags);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          className={`group flex items-stretch border-b border-border/60 ${
            selected ? 'bg-muted' : 'hover:bg-muted/50'
          }`}
        >
          <button
            type="button"
            data-meeting-item={m.id}
            disabled={disabled}
            onClick={() => onSelect(m.id)}
            className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(m.status)}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{m.title}</span>
              <span className="block text-[11px] text-muted-foreground">{formatWhen(m.createdAt)}</span>
              {templateName && (
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {templateName}
                </span>
              )}
              {m.tags.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {m.tags.slice(0, 3).map((t) => (
                    <span key={t} className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete meeting"
            disabled={disabled}
            onClick={() => onDelete(m.id)}
            className="mr-1 hidden self-center text-muted-foreground hover:text-destructive group-hover:inline-flex"
          >
            <X />
          </Button>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to folder</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => onSetFolder(m.id, null)}>No folder</ContextMenuItem>
            {flattenFolders(folders).map((f) => (
              <ContextMenuItem key={f.id} onSelect={() => onSetFolder(m.id, f.id)}>
                {' '.repeat(f.depth * 2)}
                {f.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Tags</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {tags.map((t) => (
              <ContextMenuCheckboxItem
                key={t.id}
                checked={meetingTags.has(t.name)}
                onCheckedChange={(on) => (on ? onAddTag(m.id, t.id) : onRemoveTag(m.id, t.id))}
                onSelect={(e) => e.preventDefault()}
              >
                {t.name}
              </ContextMenuCheckboxItem>
            ))}
            {tags.length > 0 && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={onNewTag}>New tag…</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" disabled={disabled} onSelect={() => onDelete(m.id)}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
