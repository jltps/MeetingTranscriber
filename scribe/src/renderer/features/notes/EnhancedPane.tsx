import { useState } from 'react';
import type { EnhancedNotes, MeetingInsights } from '../../../shared/types';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EnhancedNotesEditor } from './EnhancedNotesEditor';
import { KeyPointsList } from './KeyPointsList';
import { InsightsView } from '../insights/InsightsView';

// The enhanced-notes pane (V06 block 03; V081 adds the Insights tab here, beside
// Extended / Key points, instead of a separate header view). The in-note selector
// shows whichever of Extended / Key points / Insights are available. Local `tab`
// state resets per meeting via the `key={meetingId}` the parent sets.
type EnhancedPaneProps = {
  meetingId: number;
  /** Null for an insights-only meeting (no enhanced notes yet). */
  notes: EnhancedNotes | null;
  insights: MeetingInsights | null;
  speakerNames: Map<string, string>;
  onSaveEnhanced: (id: number, notes: EnhancedNotes) => void;
  onJump: (segmentIds: number[]) => void;
  /** Jump the live transcript to a time (from an Insights occurrence). */
  onSeek?: (startMs: number) => void;
};

type Tab = 'extended' | 'keyPoints' | 'insights';

export function EnhancedPane({
  meetingId,
  notes,
  insights,
  speakerNames,
  onSaveEnhanced,
  onJump,
  onSeek,
}: EnhancedPaneProps) {
  const hasNotes = notes !== null;
  const hasKeyPoints = (notes?.keyPoints?.length ?? 0) > 0;
  const hasInsights = insights !== null;
  const [tab, setTab] = useState<Tab>(() => (hasNotes ? 'extended' : 'insights'));

  // Which selector options to offer (only show the toggle when there's a choice).
  const options: { value: Tab; label: string }[] = [];
  if (hasNotes) options.push({ value: 'extended', label: 'Extended' });
  if (hasKeyPoints) options.push({ value: 'keyPoints', label: 'Key points' });
  if (hasInsights) options.push({ value: 'insights', label: 'Insights' });

  // Guard against a stale tab (e.g. insights arrived/!available) — fall back sensibly.
  const active: Tab = options.some((o) => o.value === tab)
    ? tab
    : (options[0]?.value ?? 'extended');

  return (
    <div className="space-y-3">
      {options.length > 1 && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={active}
          onValueChange={(v) => {
            if (v) setTab(v as Tab);
          }}
        >
          {options.map((o) => (
            <ToggleGroupItem key={o.value} value={o.value}>
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      {active === 'insights' ? (
        <InsightsView insights={insights} speakerNames={speakerNames} onSeek={onSeek} />
      ) : active === 'keyPoints' && hasKeyPoints ? (
        <KeyPointsList points={notes?.keyPoints ?? []} />
      ) : notes ? (
        <EnhancedNotesEditor
          meetingId={meetingId}
          notes={notes}
          onSave={onSaveEnhanced}
          onJump={onJump}
        />
      ) : null}
    </div>
  );
}
