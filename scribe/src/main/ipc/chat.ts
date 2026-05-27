import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import { ChatAskSchema, CrossChatAskSchema, EnhancedNotesSchema, IPC } from '../../shared/ipc-contract';
import type { ChatResult, ChatToken, CrossChatResult } from '../../shared/ipc-contract';
import type { EnhancedNotes } from '../../shared/types';
import { getEnhancerSegments, getMeeting, saveClaudeUsage } from '../db/meetings';
import { getSpeakerNames } from '../db/speakers';
import { runChat, runCrossChat } from '../chat';
import { logger } from '../logger';

function parseEnhanced(json: string | null): EnhancedNotes | null {
  if (!json) return null;
  try {
    const result = EnhancedNotesSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// Per-meeting chat runs in the main process so the Anthropic key never reaches the
// renderer (CLAUDE.md §1.2). Answer text streams back as chat:token deltas while
// the invoke is pending; the final ChatResult resolves the invoke.
export function registerChatIpc(): void {
  ipcMain.handle(IPC.chatAsk, async (event, raw): Promise<ChatResult> => {
    const input = ChatAskSchema.parse(raw);
    const meeting = getMeeting(input.meetingId);
    if (!meeting) throw new Error(`Meeting ${input.meetingId} not found`);

    const transcript = getEnhancerSegments(input.meetingId);
    const speakerNamesArr = getSpeakerNames(input.meetingId);
    const speakerNames =
      speakerNamesArr.length > 0
        ? Object.fromEntries(speakerNamesArr.map((s) => [s.rawLabel, s.displayName]))
        : undefined;

    const requestId = randomUUID();
    const result = await runChat({
      userNotes: meeting.rawUserMd,
      enhancedNotes: parseEnhanced(meeting.enhancedJson),
      transcript,
      speakerNames,
      messages: input.messages,
      onToken: (token) => {
        const payload: ChatToken = { requestId, token };
        event.sender.send(IPC.chatToken, payload);
      },
    });

    // Persist Claude token usage for cost tracking (ROADMAP_01 §3) — same as enhancement.
    try {
      saveClaudeUsage(input.meetingId, result.usage.inputTokens, result.usage.outputTokens);
    } catch (e) {
      logger.info('failed to save claude usage (chat)', String(e));
    }
    logger.info(
      'chat answer complete',
      `meeting=${input.meetingId}`,
      `turns=${input.messages.length}`,
      `degraded=${result.degraded}`,
      `cites=${result.citationIds.length}`,
      `tokens=${result.usage.inputTokens}in/${result.usage.outputTokens}out`,
    );

    // Usage stays main-process-only; return only the IPC-shaped result.
    return { text: result.text, citationIds: result.citationIds, degraded: result.degraded };
  });

  // Cross-meeting querying (ROADMAP_07 Phase 2). Streams via the same chat:token
  // push; resolves with the answer + meeting-tagged citations + per-query usage.
  ipcMain.handle(IPC.crossChatAsk, async (event, raw): Promise<CrossChatResult> => {
    const input = CrossChatAskSchema.parse(raw);
    const requestId = randomUUID();
    const result = await runCrossChat({
      scope: input.scope,
      messages: input.messages,
      onToken: (token) => {
        const payload: ChatToken = { requestId, token };
        event.sender.send(IPC.chatToken, payload);
      },
    });
    // A cross-meeting query spans many meetings, so usage is NOT written to any one
    // meeting's row — it is returned for the UI's per-query cost readout instead.
    logger.info(
      'cross-meeting chat complete',
      `scope=${input.scope.mode}`,
      `turns=${input.messages.length}`,
      `degraded=${result.degraded}`,
      `cites=${result.citations.length}`,
      `tokens=${result.usage.inputTokens}in/${result.usage.outputTokens}out`,
    );
    return result;
  });
}
