import { getDb } from './index';
import type { Folder, Tag } from '../../shared/types';

// Note organization (ROADMAP_V04_04): folders (nestable) + flat tags, main-process
// only. Deleting a folder nulls its meetings' folder_id (FK ON DELETE SET NULL) and
// cascades to subfolders; deleting a tag cascades the join rows only (§7).

type FolderRow = { id: number; name: string; parent_id: number | null; created_at: number };
type TagRow = { id: number; name: string; created_at: number };

const toFolder = (r: FolderRow): Folder => ({
  id: r.id,
  name: r.name,
  parentId: r.parent_id,
  createdAt: r.created_at,
});
const toTag = (r: TagRow): Tag => ({ id: r.id, name: r.name, createdAt: r.created_at });

/** Bump a meeting's updated_at after an organization change (for the "updated" sort). */
function touchMeeting(id: number): void {
  getDb().prepare(`UPDATE meetings SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
}

// ─── Folders ────────────────────────────────────────────────────────────────

export function listFolders(): Folder[] {
  const rows = getDb()
    .prepare(`SELECT id, name, parent_id, created_at FROM folders ORDER BY name`)
    .all() as FolderRow[];
  return rows.map(toFolder);
}

export function createFolder(name: string, parentId: number | null): Folder {
  const createdAt = Date.now();
  const info = getDb()
    .prepare(`INSERT INTO folders (name, parent_id, created_at) VALUES (?, ?, ?)`)
    .run(name, parentId, createdAt);
  return { id: Number(info.lastInsertRowid), name, parentId, createdAt };
}

export function renameFolder(id: number, name: string): void {
  getDb().prepare(`UPDATE folders SET name = ? WHERE id = ?`).run(name, id);
}

/** Re-parent a folder. Rejects cycles (a folder cannot become its own descendant). */
export function moveFolder(id: number, parentId: number | null): void {
  if (parentId === id) throw new Error('A folder cannot be moved into itself.');
  const parentStmt = getDb().prepare(`SELECT parent_id FROM folders WHERE id = ?`);
  let cur: number | null = parentId;
  while (cur !== null) {
    if (cur === id) throw new Error('A folder cannot be moved into one of its descendants.');
    const row = parentStmt.get(cur) as { parent_id: number | null } | undefined;
    cur = row?.parent_id ?? null;
  }
  getDb().prepare(`UPDATE folders SET parent_id = ? WHERE id = ?`).run(parentId, id);
}

/** Delete a folder. Subfolders cascade; meetings' folder_id is nulled by the FK (§7). */
export function deleteFolder(id: number): void {
  getDb().prepare(`DELETE FROM folders WHERE id = ?`).run(id);
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export function listTags(): Tag[] {
  const rows = getDb()
    .prepare(`SELECT id, name, created_at FROM tags ORDER BY name COLLATE NOCASE`)
    .all() as TagRow[];
  return rows.map(toTag);
}

/** Create a tag, or return the existing one (case-insensitive match) if it already exists. */
export function createTag(name: string): Tag {
  const trimmed = name.trim();
  const db = getDb();
  const existing = db
    .prepare(`SELECT id, name, created_at FROM tags WHERE name = ? COLLATE NOCASE`)
    .get(trimmed) as TagRow | undefined;
  if (existing) return toTag(existing);
  const createdAt = Date.now();
  const info = db
    .prepare(`INSERT INTO tags (name, created_at) VALUES (?, ?)`)
    .run(trimmed, createdAt);
  return { id: Number(info.lastInsertRowid), name: trimmed, createdAt };
}

export function deleteTag(id: number): void {
  getDb().prepare(`DELETE FROM tags WHERE id = ?`).run(id);
}

// ─── Assignment ─────────────────────────────────────────────────────────────

export function setMeetingFolder(meetingId: number, folderId: number | null): void {
  getDb().prepare(`UPDATE meetings SET folder_id = ? WHERE id = ?`).run(folderId, meetingId);
  touchMeeting(meetingId);
}

export function addMeetingTag(meetingId: number, tagId: number): void {
  getDb()
    .prepare(`INSERT OR IGNORE INTO meeting_tags (meeting_id, tag_id) VALUES (?, ?)`)
    .run(meetingId, tagId);
  touchMeeting(meetingId);
}

export function removeMeetingTag(meetingId: number, tagId: number): void {
  getDb()
    .prepare(`DELETE FROM meeting_tags WHERE meeting_id = ? AND tag_id = ?`)
    .run(meetingId, tagId);
  touchMeeting(meetingId);
}

// ─── Lookups (summaries + chat-scope resolution) ──────────────────────────────

/** Tag names for one meeting, sorted. */
export function tagsForMeeting(meetingId: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT t.name FROM meeting_tags mt JOIN tags t ON t.id = mt.tag_id
       WHERE mt.meeting_id = ? ORDER BY t.name COLLATE NOCASE`,
    )
    .all(meetingId) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** Tag names for every meeting, as a Map — one query, for attaching to summary lists. */
export function tagsByMeeting(): Map<number, string[]> {
  const rows = getDb()
    .prepare(
      `SELECT mt.meeting_id AS mid, t.name AS name
       FROM meeting_tags mt JOIN tags t ON t.id = mt.tag_id
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all() as Array<{ mid: number; name: string }>;
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const list = map.get(r.mid);
    if (list) list.push(r.name);
    else map.set(r.mid, [r.name]);
  }
  return map;
}

/** Meeting ids in a folder OR any of its descendants (cross-meeting chat scope). */
export function meetingIdsInFolder(folderId: number): number[] {
  const rows = getDb()
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT ?1
         UNION
         SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
       )
       SELECT id FROM meetings WHERE folder_id IN (SELECT id FROM sub)`,
    )
    .all(folderId) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/** Meeting ids carrying a tag (cross-meeting chat scope). */
export function meetingIdsWithTag(tagId: number): number[] {
  const rows = getDb()
    .prepare(`SELECT meeting_id AS id FROM meeting_tags WHERE tag_id = ?`)
    .all(tagId) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

// ─── Sidebar sort overrides (V072 block 04) ─────────────────────────────────

/** Return all manual reorder positions for the given sort mode. */
export function listSortOverrides(sortMode: string): Array<{ meetingId: number; position: number }> {
  const rows = getDb()
    .prepare(
      `SELECT meeting_id AS meetingId, position
         FROM meeting_sort_overrides
        WHERE sort_mode = ?`,
    )
    .all(sortMode) as Array<{ meetingId: number; position: number }>;
  return rows;
}

/** Upsert a meeting's manual position for the given sort mode. */
export function setSortPosition(meetingId: number, sortMode: string, position: number): void {
  getDb()
    .prepare(
      `INSERT INTO meeting_sort_overrides (meeting_id, sort_mode, position)
       VALUES (?, ?, ?)
       ON CONFLICT(meeting_id, sort_mode)
       DO UPDATE SET position = excluded.position`,
    )
    .run(meetingId, sortMode, position);
}
