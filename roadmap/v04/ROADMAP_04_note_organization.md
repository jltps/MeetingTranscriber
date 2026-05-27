# ROADMAP_04 — Note Organization: Folders + Tags

Give meetings real structure. Today the sidebar is a single flat, search-only list —
fine at ten meetings, unusable at two hundred. This block adds **folders** (a hierarchy)
and **flat tags**, makes **both into scoping units for the existing cross-meeting chat**,
and adds sidebar **date-grouping** (Today / Yesterday / This week / Earlier) and
**sort**. This is the only V04 block that touches the database.

## Why
Granola-style organization (by client / project / quarter) is the difference between a
notepad and a knowledge base. It also unlocks scoped retrieval: "ask across the *Acme*
folder" instead of all meetings. The plumbing (`RetrievalScope`) already exists — this
block widens it.

## Depends on
DB/IPC/retrieval side is **independent** (can start at step 1). The UI dressing depends
on **02** (shadcn `DropdownMenu`/`ContextMenu` + lucide). No theming dependency.

## Scope

1. **Folders (hierarchy).** Create / rename / move / delete; nestable. A meeting lives
   in zero or one folder.
2. **Tags (flat).** Create / delete; many-to-many with meetings; assign/unassign per
   meeting.
3. **Sidebar grouping + sort.** Group the list by relative date (Today / Yesterday /
   This week / Earlier) and offer sort (created / updated / title). Folder tree + tag
   filter sit above/around the list.
4. **Chat scoping.** Extend `RetrievalScope` with `folder` (incl. descendants) and `tag`
   variants; the cross-chat scope selector gains folder/tag options.

## Migration — version 9 (next; last shipped is 8)
Additive, in `main/db/migrations.ts`. Respects §7: a **folder delete nulls its
meetings, never deletes them**; subfolders cascade.

```sql
-- version 9, name: 'folders-and-tags' (ROADMAP_V04_04)
CREATE TABLE folders (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,  -- deleting a folder removes its subfolders
  created_at INTEGER NOT NULL,
  UNIQUE(parent_id, name)
);
CREATE INDEX idx_folders_parent ON folders(parent_id);

-- Deleting a folder must NOT delete meetings — null the reference
-- (CLAUDE.md §7; mirrors templates' and calendar's ON DELETE SET NULL).
ALTER TABLE meetings ADD COLUMN folder_id INTEGER
  REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_meetings_folder ON meetings(folder_id);

CREATE TABLE tags (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,          -- flat namespace; store normalized (case-insensitive unique)
  created_at INTEGER NOT NULL
);

-- meeting↔tag join. CASCADE on both sides drops only the link, never the other row.
CREATE TABLE meeting_tags (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, tag_id)
);
CREATE INDEX idx_meeting_tags_tag ON meeting_tags(tag_id);

-- For the "updated" sort. meetings has no updated_at today; backfilled to created_at.
ALTER TABLE meetings ADD COLUMN updated_at INTEGER;
```

Bump `updated_at` in `saveNotes`, `updateTitle`, and `endMeeting` (and on
folder/tag assignment). Where `updated_at` is null (legacy rows), fall back to
`COALESCE(updated_at, ended_at, started_at, created_at)` in sort queries.

## IPC to add
In `shared/ipc-contract.ts` (+ preload + new `main/ipc/organization.ts`, registered in
`ipc/index.ts`). All inputs Zod-validated:
- `folders:list` → `Folder[]`
- `folders:create` → `{ name: z.string().min(1).max(80); parentId: number|null }`
- `folders:rename` → `{ id; name }`
- `folders:move` → `{ id; parentId: number|null }` (**reject cycles in the handler** — a
  folder can't become its own descendant)
- `folders:delete` → `id` (meetings' `folder_id` goes null via the FK)
- `tags:list` → `Tag[]`; `tags:create` → `{ name }`; `tags:delete` → `id`
- `meetings:setFolder` → `{ meetingId; folderId: number|null }`
- `meetings:addTag` / `meetings:removeTag` → `{ meetingId; tagId }`
- **Extend `RetrievalScopeSchema`** (the discriminated union in `ipc-contract.ts`) with
  `{ mode:'folder'; folderId }` and `{ mode:'tag'; tagId }`. This automatically flows
  through `CrossChatAskSchema` → `runCrossChat`.
- Add an `organization` namespace to `ScribeApi`.

## Shared types
Add `Folder`, `Tag`; extend `MeetingSummary`/`MeetingDetail` with `folderId: number|null`
and `tags` (ids or names); extend `RetrievalScope` to match the schema above.

## Key decisions & caveats
- **Folder delete = null, not delete (§7).** `meetings.folder_id` is `ON DELETE SET
  NULL`; only subfolders cascade. Test against a populated DB: delete a folder holding
  meetings → meetings survive with `folder_id NULL` (§9).
- **Scope resolution lives in the main process.** Resolve `folder`/`tag` → meeting ids
  in `chat/retrieval/fts-retriever.ts` `shortlistMeetings` (recursive descendants for
  folders), then reuse the existing ranking. The renderer never enumerates the scope.
- **Tag uniqueness/casing.** Store normalized; case-insensitive unique.
- **Wipe.** Extend `wipeAllData()` in `db/settings.ts` to clear `meeting_tags`, `tags`,
  `folders` (cascade handles `meeting_tags` on meeting delete; tags/folders are
  standalone).
- **Backup/restore (decision).** Recommend extending the backup bundle to carry folders
  + tags so organization survives a restore; keep `app: 'scribe'` literal in
  `BackupBundleSchema` for back-compat (see block 09). If deferred, say so explicitly.
- FTS is unaffected — folder/tag names aren't searchable text by design (don't add them
  to `search_fts`; keep scope tight).

## Touches
`main/db/migrations.ts` (v9), new `main/db/organization.ts`, `main/db/meetings.ts`
(summary columns, sort, `updated_at` bumps), `main/db/settings.ts` (`wipeAllData`),
`main/db/export.ts` + `BackupBundleSchema`, `main/chat/retrieval/fts-retriever.ts`
(scope resolution), `shared/types.ts`, `shared/ipc-contract.ts`, `preload/index.ts`,
new `main/ipc/organization.ts`, new `renderer/features/organization/*` (FolderTree,
TagFilter, `use-organization.ts`), `renderer/features/meetings/MeetingSidebar.tsx`
(tree + tag filter + date groups + sort + "Move to…"), `renderer/features/chat/
CrossChatView.tsx` (folder/tag scope options), `renderer/app/App.tsx` (org state wiring;
create-note can target a folder).

## Acceptance
- Create/rename/move/delete folders (nested); **deleting a folder leaves its meetings
  intact with `folder_id` null**.
- Flat tags assignable/removable; many-to-many works.
- Sidebar shows date groups + a working sort control.
- Cross-meeting chat can be scoped to a folder (incl. descendants) or a tag and answers
  only from those meetings.
- Wipe removes all organization data; old backups still restore.
- Migration tested against a populated DB (§9); `pnpm typecheck/lint/test/build` green.

## Out of scope
Smart/auto folders, saved searches, drag-reordering within a folder, sharing folders,
and adding folder/tag text to full-text search.
