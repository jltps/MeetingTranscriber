import { ipcMain, dialog } from 'electron';
import { writeFile, readFile } from 'node:fs/promises';
import { IPC, MeetingIdSchema, BackupBundleSchema, EnhancedNotesSchema } from '../../shared/ipc-contract';
import type { BackupMeeting } from '../../shared/ipc-contract';
import { getMeetingExportData, getAllExportData, restoreFromBackup } from '../db/export';
import { formatAudioDuration } from '../../shared/pricing';
import { logger } from '../logger';

// ── Markdown generation ───────────────────────────────────────────────────

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Convert enhanced notes JSON to Markdown. Returns empty string on parse failure
 * so the caller can fall back to raw_user_md.
 */
function enhancedJsonToMarkdown(enhancedJson: string): string {
  try {
    const parsed = EnhancedNotesSchema.safeParse(JSON.parse(enhancedJson));
    if (!parsed.success) return '';
    const lines: string[] = [];
    for (const block of parsed.data.blocks) {
      switch (block.type) {
        case 'heading':
          lines.push(`\n## ${block.text}`);
          break;
        case 'paragraph':
          lines.push(`\n${block.text}`);
          break;
        case 'bullet':
          lines.push(`- ${block.text}`);
          break;
        case 'action_item':
          lines.push(`- [ ] ${block.text}`);
          break;
      }
    }
    return lines.join('\n').trim();
  } catch {
    return '';
  }
}

/**
 * Render all meeting data to a Markdown string. Pure function, no side-effects.
 * - Enhanced notes (if available) are rendered as structured Markdown.
 * - Speaker labels in the transcript are replaced with display names when set.
 */
export function meetingToMarkdown(data: BackupMeeting): string {
  const parts: string[] = [];

  // ── Front-matter ──────────────────────────────────────────────────────
  parts.push(`# ${data.title}`);
  parts.push('');
  parts.push(`**Date:** ${formatDate(data.createdAt)}`);
  if (data.usage.deepgramAudioMs > 0) {
    parts.push(`**Duration:** ${formatAudioDuration(data.usage.deepgramAudioMs)}`);
  }
  if (data.enhancedLang) {
    parts.push(`**Language:** ${data.enhancedLang}`);
  }
  if (data.templateName) {
    parts.push(`**Template:** ${data.templateName}`);
  }
  parts.push('');

  // ── Notes section ─────────────────────────────────────────────────────
  parts.push('---');
  parts.push('');
  parts.push('## Notes');
  parts.push('');

  const notesBody =
    data.enhancedJson ? (enhancedJsonToMarkdown(data.enhancedJson) || data.rawUserMd.trim()) : data.rawUserMd.trim();
  parts.push(notesBody || '*(no notes)*');
  parts.push('');

  // ── Transcript section ────────────────────────────────────────────────
  if (data.segments.length > 0) {
    parts.push('---');
    parts.push('');
    parts.push('## Transcript');
    parts.push('');
    for (const seg of data.segments) {
      const displayName =
        data.speakerNames.find((n) => n.rawLabel === seg.speakerLabel)?.displayName ??
        seg.speakerLabel;
      parts.push(`**${displayName}** (${formatTime(seg.startMs)}): ${seg.text}`);
    }
  }

  return parts.join('\n');
}

// ── IPC handlers ──────────────────────────────────────────────────────────

export function registerExportIpc(): void {
  // ── Phase 1: export one meeting to Markdown ─────────────────────────────
  ipcMain.handle(IPC.exportMeeting, async (_event, raw) => {
    const id = MeetingIdSchema.parse(raw);
    const data = getMeetingExportData(id);

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export meeting',
      defaultPath: `${data.title.replace(/[<>:"/\\|?*]/g, '-')}-notes.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return { success: false };

    const markdown = meetingToMarkdown(data);
    await writeFile(filePath, markdown, 'utf-8');
    logger.info('export:meeting', `id=${id}`, `path=${filePath}`);
    return { success: true, path: filePath };
  });

  // ── Phase 2a: backup all meetings to JSON ───────────────────────────────
  ipcMain.handle(IPC.exportBackup, async () => {
    const bundle = getAllExportData();
    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Backup Nexus data',
      defaultPath: `nexus-backup-${dateStamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) {
      return { success: false, meetingCount: 0 };
    }

    await writeFile(filePath, JSON.stringify(bundle, null, 2), 'utf-8');
    logger.info('export:backup', `meetings=${bundle.meetings.length}`, `path=${filePath}`);
    return { success: true, path: filePath, meetingCount: bundle.meetings.length };
  });

  // ── Phase 2b: restore from a backup file ───────────────────────────────
  ipcMain.handle(IPC.exportRestore, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Restore Nexus backup',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) {
      return { success: false, meetingCount: 0 };
    }

    const raw = await readFile(filePaths[0], 'utf-8');
    // Parse + Zod validate before touching the DB (CLAUDE.md §1.6 defence in depth).
    const parsed = BackupBundleSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Invalid backup file: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
    }

    const { meetingCount } = restoreFromBackup(parsed.data);
    logger.info('export:restore', `restored=${meetingCount}`, `path=${filePaths[0]}`);
    return { success: true, meetingCount };
  });
}
