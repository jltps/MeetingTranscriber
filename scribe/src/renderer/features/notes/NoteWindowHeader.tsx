import { Download, MessageSquare } from 'lucide-react';
import type { Folder, Tag, Template } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MeetingOrgControls } from '../organization/MeetingOrgControls';

// Unified header at the top of the note window (V072 block 02). Houses the
// per-meeting Folder picker, Tags dropdown, Original/Enhanced toggle, Export
// button, and Chat trigger — pulled here from the app-level meeting header so
// every notes-affecting control sits with the notes pane it governs. The
// Original/Enhanced toggle is disabled while chat is the active surface.
export type NoteSurface = 'notes' | 'chat';
export type NotesView = 'original' | 'enhanced';

type Props = {
  meetingId: number;
  folderId: number | null;
  tagNames: string[];
  folders: Folder[];
  tags: Tag[];
  templates: Template[];
  templateId: number | null;
  onSetTemplate: (meetingId: number, templateId: number | null) => void;
  hasEnhanced: boolean;
  /** V08 — a Gladia meeting has post-call insights (ready or processing). */
  hasInsights: boolean;
  view: NotesView;
  surface: NoteSurface;
  exporting: boolean;
  recording: boolean;
  onViewChange: (v: NotesView) => void;
  onSurfaceChange: (s: NoteSurface) => void;
  onSetFolder: (meetingId: number, folderId: number | null) => void;
  onAddTag: (meetingId: number, tagId: number) => void;
  onRemoveTag: (meetingId: number, tagId: number) => void;
  onCreateTag: (name: string) => Promise<Tag>;
  onExport: () => void;
};

export function NoteWindowHeader({
  meetingId,
  folderId,
  tagNames,
  folders,
  tags,
  templates,
  templateId,
  onSetTemplate,
  hasEnhanced,
  hasInsights,
  view,
  surface,
  exporting,
  recording,
  onViewChange,
  onSurfaceChange,
  onSetFolder,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  onExport,
}: Props) {
  const inChat = surface === 'chat';
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <MeetingOrgControls
          meetingId={meetingId}
          folderId={folderId}
          tagNames={tagNames}
          folders={folders}
          tags={tags}
          templates={templates}
          templateId={templateId}
          onSetTemplate={onSetTemplate}
          onSetFolder={onSetFolder}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onCreateTag={onCreateTag}
        />
        {(hasEnhanced || hasInsights) && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view}
            disabled={inChat}
            onValueChange={(v) => {
              if (v) onViewChange(v as NotesView);
            }}
          >
            <ToggleGroupItem value="original">Original</ToggleGroupItem>
            {/* Enhanced hosts the in-note Extended / Key points / Insights sub-tabs (V081). */}
            <ToggleGroupItem value="enhanced">Enhanced</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!recording && (
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={exporting}
            title="Export meeting to Markdown file"
          >
            <Download />
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
        )}
        <Button
          variant="ai"
          size="sm"
          aria-pressed={inChat}
          onClick={() => onSurfaceChange(inChat ? 'notes' : 'chat')}
        >
          <MessageSquare />
          {inChat ? 'Back to notes' : 'Chat'}
        </Button>
      </div>
    </div>
  );
}
