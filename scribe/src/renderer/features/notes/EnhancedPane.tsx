import { useState } from 'react';
import type { EnhancedNotes } from '../../../shared/types';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EnhancedNotesEditor } from './EnhancedNotesEditor';
import { KeyPointsList } from './KeyPointsList';

// The enhanced-notes pane (V06 block 03 + relocation). Hosts the Extended / Key points
// depth toggle INSIDE the notes screen (above the content), shown only when key points
// exist. Local `depth` state resets per meeting via the `key={meetingId}` the parent sets.
type EnhancedPaneProps = {
  meetingId: number;
  notes: EnhancedNotes;
  onSaveEnhanced: (id: number, notes: EnhancedNotes) => void;
  onJump: (segmentIds: number[]) => void;
};

export function EnhancedPane({ meetingId, notes, onSaveEnhanced, onJump }: EnhancedPaneProps) {
  const [depth, setDepth] = useState<'extended' | 'keyPoints'>('extended');
  const hasKeyPoints = (notes.keyPoints?.length ?? 0) > 0;
  const showKeyPoints = depth === 'keyPoints' && hasKeyPoints;

  return (
    <div className="space-y-3">
      {hasKeyPoints && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={depth}
          onValueChange={(v) => { if (v) setDepth(v as 'extended' | 'keyPoints'); }}
        >
          <ToggleGroupItem value="extended">Extended</ToggleGroupItem>
          <ToggleGroupItem value="keyPoints">Key points</ToggleGroupItem>
        </ToggleGroup>
      )}
      {showKeyPoints ? (
        <KeyPointsList points={notes.keyPoints ?? []} />
      ) : (
        <EnhancedNotesEditor
          meetingId={meetingId}
          notes={notes}
          onSave={onSaveEnhanced}
          onJump={onJump}
        />
      )}
    </div>
  );
}
