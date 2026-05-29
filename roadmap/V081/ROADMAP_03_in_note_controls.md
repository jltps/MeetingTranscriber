# ROADMAP_03 — In-note controls: template selector + Insights sub-tab

## Template selector → note header (first, before folders)
- Cut the template `<Select>` out of the App meeting header (`App.tsx:780-802`).
- Render it as the **first** control inside `MeetingOrgControls.tsx` (before the
  folder `Select`). Thread `templates`, `templateId`, `onSetTemplate` through
  `NoteWindowHeader` → `MeetingOrgControls`. App already owns `templates` state +
  the `setTemplate` call; reuse the `NO_TEMPLATE` sentinel.

## Insights → sub-tab under Enhanced
- `NoteWindowHeader.tsx`: remove the `insights` `ToggleGroupItem`; header view is
  `'original' | 'enhanced'` again (`NotesView` at `:13`). Show **Enhanced** when
  `hasEnhanced || hasInsights` so insights stay reachable even without enhancement.
- `App.tsx`: drop the `view === 'insights'` branch in `renderNotes()` (`:269-270`),
  the `'insights'` member of the `view` union (`:99`), and the `'insights'` in
  `commands/actions.ts` (`:42,47`). Pass `insights`, `speakerNames`, and a new
  `onSeek(startMs)` into `EnhancedPane`.
- `EnhancedPane.tsx`: extend the existing Extended/Key-points `ToggleGroup`
  (`:24-35`) with an **Insights** option when `hasInsights`; local `tab` state over
  the available options. `tab==='insights'` → `<InsightsView insights … speakerNames … onSeek />`
  (block 06). Tolerate `notes` absent (insights-only meeting): default to Insights.
- **onSeek(startMs)** in App: map the time to the overlapping `loadedSegments` id
  (reuse the overlap helper from `insights-merge.ts`) and call the existing
  `setHighlight({ ids, nonce })` (`App.tsx:141`) — same jump the transcript
  source-links use. In wide layout the transcript is already visible; in narrow,
  flip the main tab to transcript.

## Verify
`dev`: template selector is first in the note header; Original/Enhanced in header;
inside Enhanced a [Extended · Key points · Insights] selector; selecting Insights
shows the dashboard; clicking an occurrence scrolls/highlights the live transcript.
