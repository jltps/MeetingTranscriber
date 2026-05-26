# ROADMAP_02 — Speaker Naming

Let the user put real names on speakers, so transcripts and enhanced notes read
"Ana said…" instead of "Speaker 2 said…". High priority: it is one of the first
things a user wants and it lifts the perceived quality of everything downstream.

## Why early
- "Me vs them" is solid (physical channel) but remote speakers come through as
  "Speaker 1 / Speaker 2", which feels raw and makes notes harder to scan.
- Names flow into enhancement, source-linking, export, and later cross-meeting
  querying, so getting them in early improves every later block.

## Depends on
Shipped v1 (diarized segments + "Me" channel). Independent of other blocks.

## Scope

1. **Name a speaker.**
   - Rename any speaker label (including "Me") to a real name; applies across the
     whole meeting, in transcript and in enhanced notes.
   - Quick inline edit from the transcript (click the label → type a name).

2. **Merge / split corrections.**
   - Diarization mislabels: merge two labels that are the same person; reassign a
     segment that was attributed to the wrong speaker.

3. **Name suggestions (optional, nice-to-have).**
   - Offer candidate names from context the app already has (e.g. calendar
     attendees once block 06 exists, or names the user typed in notes). Suggestions
     only; the user confirms. Do not auto-assign.

4. **Remember names (optional, later).**
   - Optionally reuse names the user has applied before as suggestions in future
     meetings. Suggestion only, never automatic identification.

## Key decisions & caveats
- **Naming is metadata, not a rewrite.** Store a per-meeting mapping
  (speaker label → display name) over the existing segments; do not destructively
  edit segment rows. Re-rendering applies the mapping.
- Enhancement must use the mapped names: pass the name mapping into the enhancer so
  the notes say real names, and re-running enhancement after a rename reflects it.
- No voiceprint / biometric identification. This is manual labeling with optional
  text-based suggestions, nothing that fingerprints a voice.
- Keep it fast: naming is a frequent, low-friction action, not a settings dialog.

## Touches
Transcript UI (inline label edit, merge/reassign), a small per-meeting
speaker-mapping store (additive migration), the enhancer input (names in), export.

## Acceptance
- Renaming a speaker updates the whole meeting transcript and the next enhancement.
- Merging two labels and reassigning a stray segment both work and persist.
- Exported Markdown shows the real names.
- No automatic voice-based identification anywhere.

## Out of scope
Voiceprint/biometric speaker ID. Cross-meeting identity resolution (suggestions are
fine; automatic matching is not).
