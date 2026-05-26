// Templates CRUD (FEATURES §C). Runs in the main process only.
// All templates — including built-ins — are editable and deletable. The is_builtin
// flag is retained only for seeding idempotency in migrations.
// Deleting a template sets meetings.template_id to NULL via the FK cascade (CLAUDE.md §7).
import type { Template, TemplateCreate } from '../../shared/types';
import { getDb } from './index';

// ── Row ↔ domain mapping ──────────────────────────────────────────────────────

type TemplateRow = {
  id: number;
  name: string;
  instructions: string;
  language_mode: string;
  language_code: string | null;
  is_builtin: number;
  created_at: number;
  updated_at: number;
};

function rowToTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    languageMode: row.language_mode as Template['languageMode'],
    languageCode: row.language_code,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function listTemplates(): Template[] {
  const rows = getDb()
    .prepare('SELECT * FROM templates ORDER BY is_builtin DESC, name ASC')
    .all() as TemplateRow[];
  return rows.map(rowToTemplate);
}

export function getTemplate(id: number): Template | null {
  const row = getDb()
    .prepare('SELECT * FROM templates WHERE id = ?')
    .get(id) as TemplateRow | undefined;
  return row ? rowToTemplate(row) : null;
}

export function createTemplate(data: TemplateCreate): Template {
  const now = Date.now();
  const result = getDb()
    .prepare(
      `INSERT INTO templates (name, instructions, language_mode, language_code, is_builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(data.name, data.instructions, data.languageMode, data.languageCode, now, now);
  const row = getDb()
    .prepare('SELECT * FROM templates WHERE id = ?')
    .get(result.lastInsertRowid) as TemplateRow;
  return rowToTemplate(row);
}

export function updateTemplate(id: number, data: Partial<TemplateCreate>): Template {
  const existing = getTemplate(id);
  if (!existing) throw new Error(`Template ${id} not found`);

  const now = Date.now();
  getDb()
    .prepare(
      `UPDATE templates
       SET name          = COALESCE(?, name),
           instructions  = COALESCE(?, instructions),
           language_mode = COALESCE(?, language_mode),
           language_code = ?,
           updated_at    = ?
       WHERE id = ?`,
    )
    .run(
      data.name ?? null,
      data.instructions ?? null,
      data.languageMode ?? null,
      // Allow explicit null to clear language_code; use existing value if not in data.
      'languageCode' in data ? data.languageCode : existing.languageCode,
      now,
      id,
    );

  const updated = getTemplate(id);
  if (!updated) throw new Error(`Template ${id} vanished after update`);
  return updated;
}

export function deleteTemplate(id: number): void {
  const existing = getTemplate(id);
  if (!existing) throw new Error(`Template ${id} not found`);
  // ON DELETE SET NULL handles meetings.template_id cleanup via the FK constraint.
  getDb().prepare('DELETE FROM templates WHERE id = ?').run(id);
}

export function duplicateTemplate(id: number): Template {
  const source = getTemplate(id);
  if (!source) throw new Error(`Template ${id} not found`);
  return createTemplate({
    name: `Copy of ${source.name}`,
    instructions: source.instructions,
    languageMode: source.languageMode,
    languageCode: source.languageCode,
  });
}
