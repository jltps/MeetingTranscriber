/**
 * Tests for ROADMAP_04 export feature.
 *
 * Covers:
 *   • meetingToMarkdown — pure Markdown generation (no DB, no Electron)
 *   • BackupBundleSchema — validates backup files before restore
 *
 * DB-level (getMeetingExportData, getAllExportData, restoreFromBackup) and
 * IPC-level tests require Electron's Node.js for better-sqlite3 and are
 * verified manually.
 */
import { describe, it, expect } from 'vitest';
import { meetingToMarkdown } from '../src/main/ipc/export';
import { BackupBundleSchema } from '../src/shared/ipc-contract';
import type { BackupMeeting } from '../src/shared/ipc-contract';

// ── Test fixtures ──────────────────────────────────────────────────────────

function makeMeeting(overrides: Partial<BackupMeeting> = {}): BackupMeeting {
  return {
    id: 1,
    title: 'Q3 Planning',
    status: 'ended',
    createdAt: new Date('2026-01-15T10:00:00Z').getTime(),
    startedAt: new Date('2026-01-15T10:01:00Z').getTime(),
    endedAt: new Date('2026-01-15T10:43:30Z').getTime(),
    templateId: null,
    rawUserMd: '- Discussed roadmap\n- Agreed on Q3 targets',
    enhancedJson: null,
    enhancedAt: null,
    enhancedLang: null,
    templateName: null,
    folderId: null,
    tags: [],
    sttProvider: null,
    insights: null,
    usage: { deepgramAudioMs: 2_550_000, deepgramChannels: 2, claudeInputTokens: 3200, claudeOutputTokens: 1100 },
    segments: [
      { id: 10, channel: 1, speakerLabel: 'Speaker 1', text: 'Hello everyone', startMs: 1000, endMs: 3000 },
      { id: 11, channel: 1, speakerLabel: 'Speaker 2', text: 'Hi there', startMs: 3500, endMs: 5000 },
    ],
    speakerNames: [{ rawLabel: 'Speaker 1', displayName: 'Ana' }],
    ...overrides,
  };
}

// ── meetingToMarkdown ──────────────────────────────────────────────────────

describe('meetingToMarkdown', () => {
  it('includes the meeting title as a top-level heading', () => {
    const md = meetingToMarkdown(makeMeeting());
    expect(md).toContain('# Q3 Planning');
  });

  it('uses raw user notes when no enhanced JSON is present', () => {
    const md = meetingToMarkdown(makeMeeting({ enhancedJson: null }));
    expect(md).toContain('Discussed roadmap');
    expect(md).toContain('Agreed on Q3 targets');
  });

  it('renders enhanced notes as Markdown when available', () => {
    const enhancedJson = JSON.stringify({
      blocks: [
        { type: 'heading', text: 'Decisions', origin: 'ai', sourceSegmentIds: [10] },
        { type: 'paragraph', text: 'Team agreed to ship in Q3.', origin: 'ai', sourceSegmentIds: [11] },
        { type: 'bullet', text: 'Review design doc', origin: 'ai', sourceSegmentIds: [] },
        { type: 'action_item', text: 'Ana to update roadmap', origin: 'ai', sourceSegmentIds: [10] },
      ],
    });
    const md = meetingToMarkdown(makeMeeting({ enhancedJson }));
    expect(md).toContain('## Decisions');
    expect(md).toContain('Team agreed to ship in Q3.');
    expect(md).toContain('- Review design doc');
    expect(md).toContain('- [ ] Ana to update roadmap');
    // Falls back correctly: does not show raw notes
    expect(md).not.toContain('Discussed roadmap');
  });

  it('falls back to raw notes when enhanced JSON is corrupt', () => {
    const md = meetingToMarkdown(makeMeeting({ enhancedJson: 'not-valid-json{{{' }));
    expect(md).toContain('Discussed roadmap');
  });

  it('resolves speaker display names in the transcript', () => {
    const md = meetingToMarkdown(makeMeeting());
    expect(md).toContain('**Ana**'); // Speaker 1 → Ana
    expect(md).toContain('**Speaker 2**'); // unmapped, raw label kept
  });

  it('includes a transcript section when segments exist', () => {
    const md = meetingToMarkdown(makeMeeting());
    expect(md).toContain('## Transcript');
    expect(md).toContain('Hello everyone');
    expect(md).toContain('Hi there');
  });

  it('omits the transcript section when there are no segments', () => {
    const md = meetingToMarkdown(makeMeeting({ segments: [], speakerNames: [] }));
    expect(md).not.toContain('## Transcript');
  });

  it('includes duration when deepgramAudioMs > 0', () => {
    const md = meetingToMarkdown(makeMeeting());
    expect(md).toContain('**Duration:**');
  });

  it('omits duration when deepgramAudioMs is 0', () => {
    const md = meetingToMarkdown(
      makeMeeting({ usage: { deepgramAudioMs: 0, deepgramChannels: 1, claudeInputTokens: 0, claudeOutputTokens: 0 } }),
    );
    expect(md).not.toContain('**Duration:**');
  });

  it('includes language when enhancedLang is set', () => {
    const md = meetingToMarkdown(makeMeeting({ enhancedLang: 'pt-PT' }));
    expect(md).toContain('**Language:** pt-PT');
  });

  it('includes template name when set', () => {
    const md = meetingToMarkdown(makeMeeting({ templateName: 'Sales discovery' }));
    expect(md).toContain('**Template:** Sales discovery');
  });

  it('falls back to "(no notes)" when both rawUserMd and enhanced are empty', () => {
    const md = meetingToMarkdown(makeMeeting({ rawUserMd: '', enhancedJson: null }));
    expect(md).toContain('*(no notes)*');
  });

  it('formats transcript timestamps as M:SS', () => {
    const md = meetingToMarkdown(makeMeeting());
    // startMs: 1000 → 0:01
    expect(md).toContain('(0:01)');
    // startMs: 3500 → 0:03
    expect(md).toContain('(0:03)');
  });
});

// ── BackupBundleSchema ─────────────────────────────────────────────────────

function makeBundle(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    app: 'scribe',
    exportedAt: '2026-01-15T10:00:00.000Z',
    meetings: [],
    templates: [],
    ...overrides,
  };
}

describe('BackupBundleSchema', () => {
  it('accepts a minimal valid bundle with no meetings or templates', () => {
    expect(() => BackupBundleSchema.parse(makeBundle())).not.toThrow();
  });

  it('accepts v1, v2, and v3 versions', () => {
    expect(() => BackupBundleSchema.parse(makeBundle({ version: 1 }))).not.toThrow();
    expect(() => BackupBundleSchema.parse(makeBundle({ version: 2 }))).not.toThrow();
    // V08: v3 adds per-meeting insights + sttProvider (both default-null).
    expect(() => BackupBundleSchema.parse(makeBundle({ version: 3 }))).not.toThrow();
  });

  it('rejects an unsupported version', () => {
    expect(() => BackupBundleSchema.parse(makeBundle({ version: 4 }))).toThrow();
  });

  it('defaults folders/tags to empty for a v1 bundle (back-compat)', () => {
    const parsed = BackupBundleSchema.parse(makeBundle({ version: 1 }));
    expect(parsed.folders).toEqual([]);
    expect(parsed.tags).toEqual([]);
  });

  it('accepts a v2 bundle carrying folders + tags and per-meeting org', () => {
    const bundle = makeBundle({
      version: 2,
      folders: [{ id: 1, name: 'Clients', parentId: null, createdAt: 1000 }],
      tags: [{ id: 7, name: 'urgent', createdAt: 1000 }],
      meetings: [
        {
          id: 1,
          title: 'Filed meeting',
          status: 'ended',
          createdAt: 1000,
          startedAt: 1001,
          endedAt: 2000,
          templateId: null,
          rawUserMd: 'notes',
          enhancedJson: null,
          enhancedAt: null,
          enhancedLang: null,
          templateName: null,
          folderId: 1,
          tags: ['urgent'],
          usage: { deepgramAudioMs: 100, claudeInputTokens: 50, claudeOutputTokens: 20 },
          segments: [],
          speakerNames: [],
        },
      ],
    });
    const parsed = BackupBundleSchema.parse(bundle);
    expect(parsed.folders[0].name).toBe('Clients');
    expect(parsed.tags[0].name).toBe('urgent');
    expect(parsed.meetings[0].folderId).toBe(1);
    expect(parsed.meetings[0].tags).toEqual(['urgent']);
  });

  it('rejects wrong app identifier', () => {
    expect(() => BackupBundleSchema.parse(makeBundle({ app: 'other' }))).toThrow();
  });

  it('rejects missing exportedAt', () => {
    const b = makeBundle();
    delete (b as Record<string, unknown>).exportedAt;
    expect(() => BackupBundleSchema.parse(b)).toThrow();
  });

  it('accepts a bundle with a full meeting including segments and speaker names', () => {
    const bundle = makeBundle({
      meetings: [
        {
          id: 1,
          title: 'Test meeting',
          status: 'ended',
          createdAt: 1000,
          startedAt: 1001,
          endedAt: 2000,
          templateId: null,
          rawUserMd: 'notes',
          enhancedJson: null,
          enhancedAt: null,
          enhancedLang: null,
          templateName: null,
          usage: { deepgramAudioMs: 100, claudeInputTokens: 50, claudeOutputTokens: 20 },
          segments: [{ id: 1, channel: 0, speakerLabel: 'Me', text: 'Hello', startMs: 0, endMs: 500 }],
          speakerNames: [{ rawLabel: 'Speaker 1', displayName: 'Ana' }],
        },
      ],
    });
    const parsed = BackupBundleSchema.parse(bundle);
    expect(parsed.meetings).toHaveLength(1);
    expect(parsed.meetings[0].title).toBe('Test meeting');
  });

  it('accepts a bundle with user templates', () => {
    const bundle = makeBundle({
      templates: [
        {
          id: 5,
          name: 'My template',
          instructions: 'Do something',
          languageMode: 'global',
          languageCode: null,
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    });
    const parsed = BackupBundleSchema.parse(bundle);
    expect(parsed.templates[0].name).toBe('My template');
  });

  it('rejects a meeting missing required fields', () => {
    const bundle = makeBundle({ meetings: [{ id: 1, title: 'Incomplete' }] });
    expect(() => BackupBundleSchema.parse(bundle)).toThrow();
  });
});
