// IPC handlers for template CRUD (FEATURES §C). Follows the same validate-then-
// persist pattern as ipc/meetings.ts (CLAUDE.md §4).
import { ipcMain } from 'electron';
import {
  IPC,
  OptimizeTemplateSchema,
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
import { optimizeTemplateInstructions } from '../enhancer/optimize-template';

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

  // "Optimize with AI" — rewrite rough instructions into guidance (V06 block 02).
  // Runs in main so the Anthropic key never reaches the renderer (§1.2).
  ipcMain.handle(IPC.templatesOptimizeInstructions, async (_event, raw) => {
    const input = OptimizeTemplateSchema.parse(raw);
    return optimizeTemplateInstructions(input);
  });
}
