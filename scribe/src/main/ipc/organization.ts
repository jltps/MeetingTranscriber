import { ipcMain } from 'electron';
import {
  FolderCreateSchema,
  FolderMoveSchema,
  FolderRenameSchema,
  IPC,
  MeetingIdSchema,
  MeetingSetFolderSchema,
  MeetingTagSchema,
  TagNameSchema,
} from '../../shared/ipc-contract';
import {
  addMeetingTag,
  createFolder,
  createTag,
  deleteFolder,
  deleteTag,
  listFolders,
  listTags,
  moveFolder,
  removeMeetingTag,
  renameFolder,
  setMeetingFolder,
} from '../db/organization';

// Note organization IPC (ROADMAP_V04_04). Every input is Zod-validated before any
// DB write (CLAUDE.md §4). Folder-move cycles are rejected inside moveFolder.
export function registerOrganizationIpc(): void {
  ipcMain.handle(IPC.foldersList, () => listFolders());
  ipcMain.handle(IPC.foldersCreate, (_e, raw) => {
    const { name, parentId } = FolderCreateSchema.parse(raw);
    return createFolder(name, parentId);
  });
  ipcMain.handle(IPC.foldersRename, (_e, raw) => {
    const { id, name } = FolderRenameSchema.parse(raw);
    renameFolder(id, name);
  });
  ipcMain.handle(IPC.foldersMove, (_e, raw) => {
    const { id, parentId } = FolderMoveSchema.parse(raw);
    moveFolder(id, parentId);
  });
  ipcMain.handle(IPC.foldersDelete, (_e, raw) => deleteFolder(MeetingIdSchema.parse(raw)));

  ipcMain.handle(IPC.tagsList, () => listTags());
  ipcMain.handle(IPC.tagsCreate, (_e, raw) => createTag(TagNameSchema.parse(raw)));
  ipcMain.handle(IPC.tagsDelete, (_e, raw) => deleteTag(MeetingIdSchema.parse(raw)));

  ipcMain.handle(IPC.meetingsSetFolder, (_e, raw) => {
    const { meetingId, folderId } = MeetingSetFolderSchema.parse(raw);
    setMeetingFolder(meetingId, folderId);
  });
  ipcMain.handle(IPC.meetingsAddTag, (_e, raw) => {
    const { meetingId, tagId } = MeetingTagSchema.parse(raw);
    addMeetingTag(meetingId, tagId);
  });
  ipcMain.handle(IPC.meetingsRemoveTag, (_e, raw) => {
    const { meetingId, tagId } = MeetingTagSchema.parse(raw);
    removeMeetingTag(meetingId, tagId);
  });
}
