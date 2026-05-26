/**
 * Tests for the ROADMAP_02 speaker-naming feature.
 *
 * NOTE: better-sqlite3 is compiled against Electron's Node.js version, so we
 * cannot instantiate an actual Database in Vitest (which runs on the system
 * Node.js). Tests here cover what IS testable without Electron:
 *   • IPC schema validation for the four speaker channels
 *   • segmentsToText name-resolution logic (pure TypeScript, no DB)
 *
 * The DB layer (getSpeakerNames, setSpeakerName, clearSpeakerName,
 * reassignSegment) follows the exact same query patterns as the templates and
 * meetings DB modules and is verified during manual smoke-testing in Electron.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MeetingIdSchema } from '../src/shared/ipc-contract';
import { segmentsToText } from '../src/main/enhancer/prompt';
import type { EnhancerSegment } from '../src/main/enhancer/enhancer';

// ── Inline Zod schemas (mirrors ipc-contract.ts) ──────────────────────────

const SpeakersSetSchema = z.object({
  meetingId: MeetingIdSchema,
  rawLabel: z.string(),
  displayName: z.string().min(1),
});

const SpeakersClearSchema = z.object({
  meetingId: MeetingIdSchema,
  rawLabel: z.string(),
});

const SpeakersReassignSchema = z.object({
  meetingId: MeetingIdSchema,
  segmentId: z.number().int().positive(),
  newRawLabel: z.string(),
});

// ── IPC schema validation ──────────────────────────────────────────────────

describe('SpeakersSetSchema', () => {
  it('accepts valid set payload', () => {
    expect(
      SpeakersSetSchema.parse({ meetingId: 1, rawLabel: 'Speaker 1', displayName: 'Ana' }),
    ).toEqual({ meetingId: 1, rawLabel: 'Speaker 1', displayName: 'Ana' });
  });

  it('rejects empty displayName', () => {
    expect(() =>
      SpeakersSetSchema.parse({ meetingId: 1, rawLabel: 'Speaker 1', displayName: '' }),
    ).toThrow();
  });

  it('rejects non-integer meetingId', () => {
    expect(() =>
      SpeakersSetSchema.parse({ meetingId: 1.5, rawLabel: 'Speaker 1', displayName: 'Ana' }),
    ).toThrow();
  });

  it('rejects negative meetingId', () => {
    expect(() =>
      SpeakersSetSchema.parse({ meetingId: -1, rawLabel: 'Speaker 1', displayName: 'Ana' }),
    ).toThrow();
  });
});

describe('SpeakersClearSchema', () => {
  it('accepts valid clear payload', () => {
    expect(SpeakersClearSchema.parse({ meetingId: 3, rawLabel: 'Speaker 2' })).toEqual({
      meetingId: 3,
      rawLabel: 'Speaker 2',
    });
  });

  it('rejects missing rawLabel', () => {
    expect(() => SpeakersClearSchema.parse({ meetingId: 3 })).toThrow();
  });
});

describe('SpeakersReassignSchema', () => {
  it('accepts valid reassign payload', () => {
    expect(
      SpeakersReassignSchema.parse({ meetingId: 2, segmentId: 42, newRawLabel: 'Speaker 2' }),
    ).toEqual({ meetingId: 2, segmentId: 42, newRawLabel: 'Speaker 2' });
  });

  it('rejects segmentId of 0 (non-positive)', () => {
    expect(() =>
      SpeakersReassignSchema.parse({ meetingId: 2, segmentId: 0, newRawLabel: 'Speaker 2' }),
    ).toThrow();
  });

  it('rejects negative segmentId', () => {
    expect(() =>
      SpeakersReassignSchema.parse({ meetingId: 2, segmentId: -5, newRawLabel: 'Speaker 2' }),
    ).toThrow();
  });

  it('rejects non-integer segmentId', () => {
    expect(() =>
      SpeakersReassignSchema.parse({ meetingId: 2, segmentId: 1.5, newRawLabel: 'Speaker 2' }),
    ).toThrow();
  });
});

// ── segmentsToText name resolution ────────────────────────────────────────

const seg = (
  id: number,
  speakerLabel: string,
  text: string,
): EnhancerSegment => ({
  id,
  channel: 1 as 0 | 1,
  speakerLabel,
  text,
  startMs: 0,
  endMs: 1000,
});

describe('segmentsToText with speakerNames', () => {
  it('uses raw label when no speakerNames mapping provided', () => {
    const result = segmentsToText([seg(1, 'Speaker 1', 'Hello')]);
    expect(result).toBe('[id=1] Speaker 1: Hello');
  });

  it('replaces raw label with display name when mapping present', () => {
    const result = segmentsToText(
      [seg(1, 'Speaker 1', 'Hello')],
      { 'Speaker 1': 'Ana' },
    );
    expect(result).toBe('[id=1] Ana: Hello');
  });

  it('falls back to raw label for unmapped speakers', () => {
    const result = segmentsToText(
      [seg(1, 'Speaker 2', 'Hi there')],
      { 'Speaker 1': 'Ana' },
    );
    expect(result).toBe('[id=1] Speaker 2: Hi there');
  });

  it('resolves multiple speakers independently', () => {
    const result = segmentsToText(
      [seg(1, 'Speaker 1', 'Hello'), seg(2, 'Speaker 2', 'World'), seg(3, 'Speaker 1', 'Again')],
      { 'Speaker 1': 'Ana', 'Speaker 2': 'Bob' },
    );
    expect(result).toBe('[id=1] Ana: Hello\n[id=2] Bob: World\n[id=3] Ana: Again');
  });

  it('handles "Me" channel-0 label gracefully', () => {
    const meSeg: EnhancerSegment = { id: 5, channel: 0, speakerLabel: 'Me', text: 'I said this', startMs: 0, endMs: 500 };
    const result = segmentsToText([meSeg], { Me: 'José' });
    expect(result).toBe('[id=5] José: I said this');
  });

  it('returns empty string for empty segment array', () => {
    expect(segmentsToText([])).toBe('');
    expect(segmentsToText([], { 'Speaker 1': 'Ana' })).toBe('');
  });
});
