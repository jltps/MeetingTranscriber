import { useCallback, useEffect, useState } from 'react';
import type { Folder, Tag } from '../../../shared/types';

export type OrganizationController = {
  folders: Folder[];
  tags: Tag[];
  reload: () => Promise<void>;
  createFolder: (name: string, parentId: number | null) => Promise<Folder>;
  renameFolder: (id: number, name: string) => Promise<void>;
  moveFolder: (id: number, parentId: number | null) => Promise<void>;
  deleteFolder: (id: number) => Promise<void>;
  createTag: (name: string) => Promise<Tag>;
  deleteTag: (id: number) => Promise<void>;
};

// Owns the folder + tag lists (ROADMAP_V04_04). Folder/tag CRUD reloads these
// lists; per-meeting assignment lives in App (it refreshes the meeting list/detail).
export function useOrganization(): OrganizationController {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const reload = useCallback(async () => {
    const [f, t] = await Promise.all([
      window.api.organization.listFolders(),
      window.api.organization.listTags(),
    ]);
    setFolders(f);
    setTags(t);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createFolder = useCallback(
    async (name: string, parentId: number | null) => {
      const folder = await window.api.organization.createFolder(name, parentId);
      await reload();
      return folder;
    },
    [reload],
  );
  const renameFolder = useCallback(
    async (id: number, name: string) => {
      await window.api.organization.renameFolder(id, name);
      await reload();
    },
    [reload],
  );
  const moveFolder = useCallback(
    async (id: number, parentId: number | null) => {
      await window.api.organization.moveFolder(id, parentId);
      await reload();
    },
    [reload],
  );
  const deleteFolder = useCallback(
    async (id: number) => {
      await window.api.organization.deleteFolder(id);
      await reload();
    },
    [reload],
  );
  const createTag = useCallback(
    async (name: string) => {
      const tag = await window.api.organization.createTag(name);
      await reload();
      return tag;
    },
    [reload],
  );
  const deleteTag = useCallback(
    async (id: number) => {
      await window.api.organization.deleteTag(id);
      await reload();
    },
    [reload],
  );

  return {
    folders,
    tags,
    reload,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    createTag,
    deleteTag,
  };
}

// ── Tree helpers (shared by FolderTree + Move-to menus) ──────────────────────

export type FolderNode = Folder & { depth: number };

/** Flatten folders into a depth-annotated, name-sorted, parent-before-child order. */
export function flattenFolders(folders: Folder[], expanded?: Set<number>): FolderNode[] {
  const byParent = new Map<number | null, Folder[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const out: FolderNode[] = [];
  const walk = (parentId: number | null, depth: number): void => {
    for (const f of byParent.get(parentId) ?? []) {
      out.push({ ...f, depth });
      if (!expanded || expanded.has(f.id)) walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Folder ids that have at least one child (so the tree can show a chevron). */
export function foldersWithChildren(folders: Folder[]): Set<number> {
  const set = new Set<number>();
  for (const f of folders) if (f.parentId !== null) set.add(f.parentId);
  return set;
}
