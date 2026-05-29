# ROADMAP_04 — Tags: select-or-create combobox

`scribe/src/renderer/features/organization/MeetingOrgControls.tsx`. Today the
tags affordance is a checkbox `DropdownMenu` + a separate "New tag…" `NameDialog`
(`:71-111`).

- Replace it with one **searchable combobox**: a `Popover` + `cmdk` `Command`
  (cmdk is already a dep; see `features/commands/` for the palette usage pattern).
- Behaviour: typing filters existing tags (each is a `CommandItem`; selecting
  toggles meeting membership inline via `onAddTag`/`onRemoveTag`). When the query
  has no exact (case-insensitive) match, show a **"Create '<query>'"** item that
  calls `onCreateTag(query)` then `onAddTag(meetingId, tag.id)`.
- Show currently-applied tags as small removable chips next to the button (reuse
  `tagNames`); the trigger button keeps the count badge.
- Reuse `useOrganization` (`createTag`, `addMeetingTag`, `removeMeetingTag`,
  `use-organization.ts`). Props on `MeetingOrgControls` are unchanged
  (`onAddTag`/`onRemoveTag`/`onCreateTag` already exist).
- If `components/ui/command.tsx` doesn't exist, add a minimal shadcn-style wrapper
  around `cmdk` (check `components/ui/` first).

## Verify
`dev`: click Tags → type to filter and toggle existing tags, or type a new name
and pick "Create '…'" to create + apply in one step.
