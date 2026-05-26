// IPC handlers for template CRUD (FEATURES §C). Follows the same validate-then-
// persist pattern as ipc/meetings.ts (CLAUDE.md §4).
import { ipcMain } from 'electron';
import {
  IPC,
  TemplateCreateSchema,
  TemplateIdSchema,
  TemplateUpdateSchema,
} from '../../shared/ipc-contract';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from '../db/templates';

export function registerTemplatesIpc(): void {
  ipcMain.handle(IPC.templatesList, () => listTemplates());

  ipcMain.handle(IPC.templatesGet, (_event, raw) => {
    const id = TemplateIdSchema.parse(raw);
    return getTemplate(id);
  });

  ipcMain.handle(IPC.templatesCreate, (_event, raw) => {
    const data = TemplateCreateSchema.parse(raw);
    return createTemplate(data);
  });

  ipcMain.handle(IPC.templatesUpdate, (_event, raw) => {
    const { id, ...rest } = (raw as { id: number } & Record<string, unknown>);
    const validId = TemplateIdSchema.parse(id);
    const data = TemplateUpdateSchema.parse(rest);
    return updateTemplate(validId, data);
  });

  ipcMain.handle(IPC.templatesDelete, (_event, raw) => {
    const id = TemplateIdSchema.parse(raw);
    deleteTemplate(id);
  });

  ipcMain.handle(IPC.templatesDuplicate, (_event, raw) => {
    const id = TemplateIdSchema.parse(raw);
    return duplicateTemplate(id);
  });
}
