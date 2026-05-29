/**
 * V08 — Zod contract tests for the new insights wire types + provider additions.
 */
import { describe, it, expect } from 'vitest';
import {
  InsightsStatusSchema,
  MeetingInsightsSchema,
  SetKeysSchema,
  TestProviderSchema,
} from '../src/shared/ipc-contract';

describe('MeetingInsightsSchema', () => {
  const valid = {
    provider: 'gladia',
    status: 'ready',
    utterances: [
      {
        text: 'hi',
        speaker: 0,
        speakerLabel: 'Me',
        isMe: true,
        startMs: 0,
        endMs: 1000,
        channel: 0,
        entities: [{ kind: 'person', text: 'Ana', start: 0, end: 3 }],
        sentiment: { label: 'positive', emotion: 'joy' },
      },
    ],
    summary: {
      speakers: [{ label: 'Me', talkMs: 1000, utteranceCount: 1 }],
      entityCounts: [{ kind: 'person', count: 1 }],
      topEntities: [{ text: 'Ana', kind: 'person', count: 1 }],
      sentiment: { positive: 1, neutral: 0, negative: 0 },
    },
  };

  it('accepts a well-formed payload', () => {
    expect(MeetingInsightsSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a bad sentiment label and a non-0/1 channel', () => {
    expect(
      MeetingInsightsSchema.safeParse({
        ...valid,
        utterances: [{ ...valid.utterances[0], sentiment: { label: 'angry' } }],
      }).success,
    ).toBe(false);
    expect(
      MeetingInsightsSchema.safeParse({
        ...valid,
        utterances: [{ ...valid.utterances[0], channel: 2 }],
      }).success,
    ).toBe(false);
  });
});

describe('InsightsStatusSchema', () => {
  it('accepts processing/ready/error with a positive meetingId', () => {
    expect(InsightsStatusSchema.safeParse({ meetingId: 3, status: 'processing' }).success).toBe(true);
    expect(InsightsStatusSchema.safeParse({ meetingId: 3, status: 'done' }).success).toBe(false);
    expect(InsightsStatusSchema.safeParse({ meetingId: 0, status: 'ready' }).success).toBe(false);
  });
});

describe('provider additions', () => {
  it('SetKeysSchema accepts a gladia key', () => {
    expect(SetKeysSchema.safeParse({ gladia: 'k' }).success).toBe(true);
  });
  it('TestProviderSchema accepts gladia', () => {
    expect(TestProviderSchema.safeParse('gladia').success).toBe(true);
    expect(TestProviderSchema.safeParse('nope').success).toBe(false);
  });
});
