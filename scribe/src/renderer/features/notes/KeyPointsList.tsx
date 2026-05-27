// Read-only "Key points" view of an enhancement (V06 block 03). Key points are an
// AI-derived skimmable summary; the editable, user-owned content lives in the Extended
// view (EnhancedNotesEditor). Reuses the .notes-editor typography tokens for a
// consistent look.
type KeyPointsListProps = {
  points: string[];
};

export function KeyPointsList({ points }: KeyPointsListProps) {
  return (
    <div className="notes-editor" data-testid="key-points">
      <ul>
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
